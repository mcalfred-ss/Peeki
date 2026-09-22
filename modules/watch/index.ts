/**
 * On-duty live coach: Peeki watches the user's screen and nudges when helpful.
 * Quiet when things look fine — never spam. Uses recent session goal when available.
 */
import { createHash } from 'crypto'
import type { AgentDecision, AppSettings, ScreenCapture } from '../shared'
import type { CaptureModule } from '../capture'
import { burnCoordinateGrid } from '../capture/gridOverlay'
import type { AiModule } from '../ai'
import type { PrivacyModule } from '../privacy'
import type { MemoryModule } from '../memory/types'
import { buildScreenElementMap, formatMapForPrompt } from '../screenIntel'

export type WatchModule = {
  start: () => void
  stop: () => void
  setEnabled: (enabled: boolean) => void
  isEnabled: () => boolean
  getStatus: () => {
    enabled: boolean
    intervalSec: number
    lastCheckedAt: string | null
    lastNudgeAt: string | null
    activeGoal: string | null
  }
}

export type WatchDeps = {
  capture: CaptureModule
  ai: AiModule
  privacy: PrivacyModule
  memory: MemoryModule
  getSettings: () => AppSettings
  beforeCapture?: () => Promise<void> | void
  afterCapture?: () => Promise<void> | void
  onNudge: (decision: AgentDecision, capture: ScreenCapture) => void
  onStateChange?: (enabled: boolean) => void
  onLookingStart?: () => void
  onLookingEnd?: () => void
}

function fingerprint(capture: ScreenCapture): string {
  const sample = capture.dataUrl.slice(0, 12000) + capture.dataUrl.slice(-4000)
  return createHash('sha1')
    .update(sample)
    .update(String(capture.width))
    .update(String(capture.height))
    .digest('hex')
}

function isQuietNudge(decision: AgentDecision): boolean {
  const g = decision.guidance.trim().toLowerCase()
  if (
    g.startsWith('looking good') ||
    g.startsWith('all good') ||
    g.startsWith('keep going') ||
    (g.includes('continue') && g.length < 48) ||
    decision.confidence < 0.4
  ) {
    return true
  }
  return false
}

function buildWatchInstruction(activeGoal: string | null, nextStep: string | null): string {
  const goalBlock = activeGoal
    ? [
        `Active user goal (from recent ask): ${activeGoal}`,
        nextStep ? `Last suggested next step: ${nextStep}` : '',
        'Coach them toward that goal on THIS screen.'
      ]
        .filter(Boolean)
        .join('\n')
    : 'No specific goal yet — only nudge if they look stuck, hit an error, or a wrong dialog is open.'

  return [
    'You are Peeki, ON DUTY — a live Windows coach watching the user work in real time.',
    goalBlock,
    '',
    'Rules:',
    '- If progress looks fine: set guidance exactly to: Looking good — continue.',
    '- If stuck / error / wrong place / clear next click: give ONE short tip (≤2 sentences).',
    '- At most 1 tight highlight on the exact control they need; else highlights=[].',
    '- proposedActions must be [].',
    '- Do not narrate the whole screen. Do not invent apps that are not visible.',
    '- Prefer naming visible UI from the element map when provided.'
  ].join('\n')
}

export function createWatchService(deps: WatchDeps): WatchModule {
  let timer: NodeJS.Timeout | null = null
  let running = false
  let lastHash: string | null = null
  let lastCheckedAt: string | null = null
  let lastNudgeAt: string | null = null
  let lastActiveGoal: string | null = null
  let inFlight = false
  let consecutiveQuiet = 0

  function readGoal(): { goal: string | null; nextStep: string | null } {
    const recent = deps.memory.getRecent(3)
    if (recent.length === 0) return { goal: null, nextStep: null }
    const last = recent[recent.length - 1]
    const goal = (last.userGoal || last.instruction || '').trim()
    if (!goal || /looking good/i.test(last.guidance)) {
      return { goal: null, nextStep: null }
    }
    // Skip pure inventory / locate-only goals for continuous coaching pressure
    if (/^(count|list)\b/i.test(goal) || /find |where is|located/i.test(goal) && goal.length < 40) {
      return { goal: goal.slice(0, 160), nextStep: last.nextStep ?? null }
    }
    return { goal: goal.slice(0, 200), nextStep: last.nextStep ?? null }
  }

  function intervalMs(): number {
    const base = Math.max(8, deps.getSettings().watchIntervalSec || 12)
    const { goal } = readGoal()
    // Faster when actively coaching a goal; back off after many quiet ticks
    if (goal && consecutiveQuiet < 3) return Math.min(base, 10) * 1000
    if (consecutiveQuiet >= 5) return Math.max(base, 20) * 1000
    return base * 1000
  }

  async function tick(): Promise<void> {
    if (!running || inFlight) return
    if (!deps.ai.isConfigured()) return

    inFlight = true
    deps.onLookingStart?.()
    try {
      let capture: ScreenCapture
      try {
        await deps.beforeCapture?.()
        await new Promise((r) => setTimeout(r, 60))
        // Follow the display the user is actually on
        capture = await deps.capture.captureActiveDisplay(
          Math.min(1280, deps.getSettings().maxCaptureWidth)
        )
        if (deps.getSettings().privacyBlurEnabled) {
          capture = deps.privacy.applyBlur(capture)
        }
      } finally {
        try {
          await deps.afterCapture?.()
        } catch {
          // ignore
        }
      }

      const hash = fingerprint(capture)
      lastCheckedAt = new Date().toISOString()
      if (lastHash && hash === lastHash) {
        consecutiveQuiet += 1
        return
      }
      lastHash = hash

      const { goal, nextStep } = readGoal()
      lastActiveGoal = goal

      let elementMapText: string | undefined
      try {
        const map = await buildScreenElementMap({
          capture,
          includeOcr: false,
          maxUiElements: 80,
          budgetMs: 1800
        })
        elementMapText = formatMapForPrompt(map, 36)
      } catch {
        elementMapText = undefined
      }

      const decision = await deps.ai.analyzeScreen({
        instruction: buildWatchInstruction(goal, nextStep),
        capture: burnCoordinateGrid(capture),
        model: deps.getSettings().model,
        allowProposedActions: false,
        recentTurns: deps.memory.getRecent(2),
        mode: 'normal',
        elementMapText
      })

      if (
        decision.confidence === 0 &&
        decision.screenSummary.toLowerCase().startsWith('unable to analyze')
      ) {
        return
      }

      if (isQuietNudge(decision)) {
        consecutiveQuiet += 1
        return
      }

      consecutiveQuiet = 0
      lastNudgeAt = new Date().toISOString()
      console.log(
        [
          'ON DUTY NUDGE',
          `goal: ${goal || '(none)'}`,
          `guidance: ${decision.guidance.slice(0, 120)}`
        ].join('\n')
      )
      deps.onNudge(decision, capture)
    } catch (err) {
      console.warn('On-duty watch tick failed:', err)
    } finally {
      deps.onLookingEnd?.()
      inFlight = false
    }
  }

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function scheduleNext(): void {
    clearTimer()
    if (!running) return
    timer = setTimeout(() => {
      void tick().finally(() => {
        scheduleNext()
      })
    }, intervalMs())
  }

  function stop(): void {
    running = false
    clearTimer()
    deps.onStateChange?.(false)
    console.log('ON DUTY: off')
  }

  function start(): void {
    running = true
    consecutiveQuiet = 0
    lastHash = null
    clearTimer()
    deps.onStateChange?.(true)
    console.log('ON DUTY: live coach watching')
    void tick().finally(() => {
      scheduleNext()
    })
  }

  function setEnabled(enabled: boolean): void {
    if (enabled) start()
    else stop()
  }

  function isEnabled(): boolean {
    return running
  }

  function getStatus() {
    return {
      enabled: running,
      intervalSec: Math.round(intervalMs() / 1000),
      lastCheckedAt,
      lastNudgeAt,
      activeGoal: lastActiveGoal
    }
  }

  return {
    start,
    stop,
    setEnabled,
    isEnabled,
    getStatus
  }
}
