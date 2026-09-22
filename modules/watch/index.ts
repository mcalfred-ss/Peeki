import { createHash } from 'crypto'
import type { AgentDecision, AppSettings, ScreenCapture } from '../shared'
import type { CaptureModule } from '../capture'
import type { AiModule } from '../ai'
import type { PrivacyModule } from '../privacy'

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
  }
}

export type WatchDeps = {
  capture: CaptureModule
  ai: AiModule
  privacy: PrivacyModule
  getSettings: () => AppSettings
  beforeCapture?: () => Promise<void> | void
  afterCapture?: () => Promise<void> | void
  onNudge: (decision: AgentDecision, capture: ScreenCapture) => void
  onStateChange?: (enabled: boolean) => void
}

const WATCH_INSTRUCTION = [
  'Watch mode check (brief).',
  'Look at the current Windows screen.',
  'If the user looks stuck, is on an error/wrong dialog, or clearly needs one tip, give a short nudge.',
  'If things look fine, set guidance exactly to: Looking good — continue.',
  'Keep guidance under 2 short sentences.',
  'Include at most 1 highlight if pointing helps; otherwise highlights=[].',
  'proposedActions must be [].',
  'steps may be [].'
].join(' ')

function fingerprint(capture: ScreenCapture): string {
  // Cheap change detector: hash a slice of the data URL
  const sample = capture.dataUrl.slice(0, 12000) + capture.dataUrl.slice(-4000)
  return createHash('sha1').update(sample).update(String(capture.width)).update(String(capture.height)).digest('hex')
}

function isQuietNudge(decision: AgentDecision): boolean {
  const g = decision.guidance.trim().toLowerCase()
  if (
    g.startsWith('looking good') ||
    (g.includes('continue') && g.length < 40) ||
    decision.confidence < 0.35
  ) {
    return true
  }
  return false
}

export function createWatchService(deps: WatchDeps): WatchModule {
  let timer: NodeJS.Timeout | null = null
  let running = false
  let lastHash: string | null = null
  let lastCheckedAt: string | null = null
  let lastNudgeAt: string | null = null
  let inFlight = false

  function intervalMs(): number {
    const sec = Math.max(8, deps.getSettings().watchIntervalSec || 15)
    return sec * 1000
  }

  async function tick(): Promise<void> {
    if (!running || inFlight) return
    if (!deps.ai.isConfigured()) return

    inFlight = true
    try {
      await deps.beforeCapture?.()
      await new Promise((r) => setTimeout(r, 80))
      let capture = await deps.capture.capturePrimaryDisplay(
        Math.min(1024, deps.getSettings().maxCaptureWidth)
      )
      if (deps.getSettings().privacyBlurEnabled) {
        capture = deps.privacy.applyBlur(capture)
      }

      const hash = fingerprint(capture)
      lastCheckedAt = new Date().toISOString()
      if (lastHash && hash === lastHash) {
        return
      }
      lastHash = hash

      const decision = await deps.ai.analyzeScreen({
        instruction: WATCH_INSTRUCTION,
        capture,
        model: deps.getSettings().model,
        allowProposedActions: false,
        recentTurns: [],
        mode: 'normal'
      })

      if (
        decision.confidence === 0 &&
        decision.screenSummary.toLowerCase().startsWith('unable to analyze')
      ) {
        return
      }

      if (isQuietNudge(decision)) {
        return
      }

      lastNudgeAt = new Date().toISOString()
      deps.onNudge(decision, capture)
    } catch {
      // Watch failures should stay silent
    } finally {
      try {
        await deps.afterCapture?.()
      } catch {
        // ignore
      }
      inFlight = false
    }
  }

  function stop(): void {
    running = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    deps.onStateChange?.(false)
  }

  function start(): void {
    stop()
    running = true
    deps.onStateChange?.(true)
    void tick()
    timer = setInterval(() => {
      void tick()
    }, intervalMs())
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
      intervalSec: Math.max(8, deps.getSettings().watchIntervalSec || 15),
      lastCheckedAt,
      lastNudgeAt
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
