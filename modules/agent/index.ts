import type {
  AgentRunRequest,
  AgentRunResult,
  AppSettings,
  CoachMode
} from '../shared'
import type {
  AbsoluteMark,
  CanonicalTarget,
  ScreenElementMap,
  TargetMatch
} from '../shared/screenIntel'
import { targetMatchToCanonical } from '../shared/screenIntel'
import type { CaptureModule } from '../capture'
import { burnCoordinateGrid } from '../capture/gridOverlay'
import type { AiModule } from '../ai'
import type { PermissionModule } from '../permissions/types'
import type { MemoryModule } from '../memory/types'
import type { PrivacyModule } from '../privacy'
import type { HistoryModule } from '../history'
import {
  buildScreenElementMap,
  formatMapForPrompt,
  formatDesktopInventoryForPrompt,
  isStrongMatch,
  localizeTargetInRegion,
  logTargetPipeline,
  marksFromMatch,
  normalizedToPhysical,
  resolveTarget,
  dipToPhysicalPoint,
  validateCanonicalTarget,
  buildInventoryDecision,
  buildLocateDecision,
  planSession,
  setCoachTrack,
  filterCoachingHighlights,
  inferForegroundAppName,
  isCoachingRequest,
  verifyAndContinue
} from '../screenIntel'
import { listRankedCandidates } from '../screenIntel/resolve'
import type { AgentModule } from './types'

export type AgentDeps = {
  capture: CaptureModule
  ai: AiModule
  permissions: PermissionModule
  memory: MemoryModule
  privacy: PrivacyModule
  history?: HistoryModule
  getSettings: () => AppSettings
  beforeCapture?: () => Promise<void> | void
  afterCapture?: () => Promise<void> | void
}
const CAPTURE_SETTLE_MS = 120
const MEMORY_CONTEXT_TURNS = 5

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolvePinnedMode(request: AgentRunRequest, settings: AppSettings): CoachMode {
  return request.mode ?? settings.coachMode ?? 'auto'
}

function displayOriginPhysical(capture: {
  displayBounds?: { x: number; y: number; width: number; height: number }
}): { x: number; y: number } {
  const b = capture.displayBounds
  if (!b) return { x: 0, y: 0 }
  return dipToPhysicalPoint(b.x, b.y)
}

function formatDebugMap(
  map: ScreenElementMap,
  instruction: string,
  match: TargetMatch | null,
  intent: string,
  locked: boolean
): string {
  const lines: string[] = [
    '======== PEEKI TARGET PIPELINE ========',
    `USER REQUEST:`,
    `"${instruction}"`,
    '',
    `INTENT:`,
    intent
  ]

  const ranked = listRankedCandidates(map, instruction, 8)
  lines.push('', 'CANDIDATES:')
  if (ranked.length === 0) {
    lines.push('(none)')
  } else {
    ranked.forEach((r, i) => {
      lines.push(
        `${i + 1}. ${r.name}`,
        `   source: ${r.source}`,
        `   type: ${r.category ?? '?'}`,
        `   match: ${r.kind ?? '?'}`,
        `   confidence/score: ${r.score.toFixed(1)}`,
        `   bounds: x=${r.bounds.x} y=${r.bounds.y} w=${r.bounds.width} h=${r.bounds.height}`
      )
    })
  }

  lines.push('', 'SELECTED TARGET:')
  if (match) {
    lines.push(match.label)
    lines.push(`SOURCE: ${match.source}`)
    lines.push(`TYPE: ${match.targetType ?? '?'}`)
    lines.push(`MATCH: ${match.matchKind ?? '?'}`)
    lines.push(`CONFIDENCE: ${match.confidence.toFixed(3)}`)
    lines.push(
      `BOUNDS: x=${match.bounds.x} y=${match.bounds.y} w=${match.bounds.width} h=${match.bounds.height}`
    )
  } else {
    lines.push('(none)')
  }

  lines.push('', 'FINAL TARGET:')
  if (match && locked) {
    lines.push(match.label)
    lines.push(`SOURCE: ${match.source}`)
    lines.push(`TYPE: ${match.targetType ?? '?'}`)
    lines.push('(same as SELECTED — canonical lock)')
  } else if (match) {
    lines.push(match.label)
    lines.push(`SOURCE: ${match.source}`)
    lines.push('(not locked)')
  } else {
    lines.push('(none)')
  }

  lines.push('', '--- raw map (truncated) ---', 'UIA / Desktop:')
  for (const el of map.uiElements.slice(0, 40)) {
    const b = el.bounds
    lines.push(`[${el.name}] [${el.role}] [${b.x},${b.y},${b.width},${b.height}]`)
  }
  lines.push('', 'OCR:')
  for (const el of map.ocrElements.slice(0, 40)) {
    const b = el.bounds
    lines.push(`[${el.text}] [${b.x},${b.y},${b.width},${b.height}]`)
  }
  lines.push('=======================================')
  return lines.join('\n')
}

export function createAgentOrchestrator(deps: AgentDeps): AgentModule {
  async function run(request: AgentRunRequest): Promise<AgentRunResult> {
    const settings = deps.getSettings()
    const instruction = request.instruction.trim()
    const memoryTurnCount = deps.memory.size()
    const pinnedMode = resolvePinnedMode(request, settings)

    if (!instruction) {
      return { ok: false, error: 'Please enter an instruction.', memoryTurnCount, mode: pinnedMode }
    }

    const allowProposedActions =
      Boolean(request.allowProposedActions) &&
      deps.permissions.canProposeActions(settings)

    const plan = planSession({
      instruction,
      settingsMode: pinnedMode,
      allowProposedActions
    })
    const mode = plan.effectiveMode
    const pointing = plan.pointing
    const inventory = plan.inventory
    const progress = plan.progress
    const coaching = isCoachingRequest(instruction) || plan.intent === 'coaching'

    console.log(
      [
        'SESSION PLAN',
        `pinned: ${pinnedMode}`,
        `effective: ${mode}`,
        `intent: ${plan.intent}`,
        `preferLocal: ${plan.preferLocal}`,
        `progress: ${progress}`,
        `coaching: ${coaching}`,
        `reason: ${plan.reason}`,
        plan.suggestion ? `suggest: ${plan.suggestion.recommended} — ${plan.suggestion.reason}` : 'suggest: (none)'
      ].join('\n')
    )

    let capture
    let visionCapture
    try {
      await deps.beforeCapture?.()
      await sleep(CAPTURE_SETTLE_MS)
      capture = await deps.capture.captureActiveDisplay(settings.maxCaptureWidth)
      if (settings.privacyBlurEnabled) {
        capture = deps.privacy.applyBlur(capture)
      }
      // Grid burn only when we may need vision (saves work on local answers)
      if (!inventory && !pointing && !progress) {
        visionCapture = burnCoordinateGrid(capture)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screen capture failed'
      return { ok: false, error: message, memoryTurnCount, mode }
    } finally {
      try {
        await deps.afterCapture?.()
      } catch {
        // ignore restore failures
      }
    }

    if (!capture) {
      return { ok: false, error: 'Screen capture failed', memoryTurnCount, mode }
    }

    const recentTurns = deps.memory.getRecent(MEMORY_CONTEXT_TURNS)

    const attachSuggestion = (decision: import('../shared').AgentDecision) => {
      if (plan.suggestion) {
        decision.modeSuggestion = plan.suggestion
      }
      return decision
    }

    const finish = (decision: import('../shared').AgentDecision) => {
      attachSuggestion(decision)
      deps.memory.add({
        instruction,
        screenSummary: decision.screenSummary,
        userGoal: decision.userGoal,
        guidance: decision.guidance,
        nextStep: decision.nextStep
      })
      try {
        deps.history?.add({
          instruction,
          guidance: decision.guidance,
          nextStep: decision.nextStep,
          screenSummary: decision.screenSummary,
          mode,
          stepCount: decision.steps.length
        })
      } catch {
        // history is best-effort
      }
      return {
        ok: true as const,
        decision,
        capture,
        memoryTurnCount: deps.memory.size(),
        mode
      }
    }

    try {
      let elementMapText: string | undefined
      let resolvedLabel: string | undefined
      let absoluteMarks: AbsoluteMark[] | undefined
      let targetSource: TargetMatch['source'] | undefined
      let debugMapText: string | undefined
      let match: TargetMatch | null = null
      let map: ScreenElementMap | null = null

      try {
        map = await buildScreenElementMap({
          capture,
          includeOcr: pointing && !inventory,
          maxUiElements: pointing || inventory ? 180 : 100,
          budgetMs: pointing || inventory ? 4000 : 2500
        })

        // ── Local fast path: inventory (no AI credits) ──
        if (inventory) {
          console.log(
            [
              '======== PEEKI TARGET PIPELINE ========',
              `USER REQUEST: "${instruction}"`,
              'INTENT: inventory',
              'ACTION: local UIA answer — SKIPPING AI (no credits)',
              `DESKTOP ICONS: ${map.uiElements.filter((u) => u.role === 'DesktopIcon').length}`,
              'FINAL TARGET: (none — inventory)',
              '======================================='
            ].join('\n')
          )
          const decision = buildInventoryDecision(instruction, map)
          decision.usedLocalAnswer = true
          if (settings.debugScreenIntel) {
            decision.debugMapText = formatDesktopInventoryForPrompt(map)
            console.log(decision.debugMapText)
          }
          return finish(decision)
        }

        // ── Progress: re-check the CURRENT screen, then continue ──
        if (progress) {
          console.log(
            [
              '======== PEEKI TARGET PIPELINE ========',
              `USER REQUEST: "${instruction}"`,
              'INTENT: progress',
              'ACTION: verify on current screen, then continue',
              '======================================='
            ].join('\n')
          )
          const decision = await verifyAndContinue({
            instruction,
            map,
            capture,
            ai: deps.ai,
            model: settings.model,
            allowProposedActions
          })
          if (settings.debugScreenIntel) {
            decision.debugMapText = formatDebugMap(map, instruction, null, 'progress', false)
            console.log(decision.debugMapText)
          }
          return finish(decision)
        }

        elementMapText = formatMapForPrompt(map, pointing || coaching ? 70 : 40)
        const foreground = inferForegroundAppName(map)
        if (foreground) {
          elementMapText = [
            `ACTIVE / LARGE WINDOW (user is likely already here): ${foreground}`,
            coaching
              ? 'COACHING MODE: user wants help on the current work. Do not highlight this window title or a desktop icon for it.'
              : '',
            elementMapText
          ]
            .filter(Boolean)
            .join('\n')
          console.log(`FOREGROUND APP: ${foreground}`)
        }
        match = resolveTarget(map, instruction)

        let canonical: CanonicalTarget | null = match ? targetMatchToCanonical(match) : null
        if (canonical) {
          const validation = validateCanonicalTarget(canonical, map, instruction)
          console.log(
            `TARGET VALIDATION: ok=${validation.ok} reason=${validation.reason} source=${canonical.source} name="${canonical.name}"`
          )
          if (!validation.ok) {
            console.log(
              `CANONICAL TARGET REJECTED — clearing for possible vision fallback\nreason: ${validation.reason}`
            )
            canonical = null
            match = null
          }
        }

        if (canonical && match) {
          logTargetPipeline(match)
          resolvedLabel = canonical.name
          targetSource = canonical.source
          absoluteMarks = marksFromMatch(match)
          const lockedStructural = match.source !== 'vision'
          console.log(
            [
              'CANONICAL TARGET LOCKED',
              `name: ${canonical.name}`,
              `source: ${canonical.source}`,
              `type: ${canonical.type}`,
              `confidence: ${canonical.confidence.toFixed(3)}`,
              `bounds: x=${canonical.bounds.x} y=${canonical.bounds.y} w=${canonical.bounds.width} h=${canonical.bounds.height}`,
              'FINAL TARGET equals SELECTED TARGET — vision will NOT replace'
            ].join('\n')
          )

          // ── Local fast path: UIA/desktop already found the target ──
          if (lockedStructural && pointing) {
            console.log('LOCAL LOCATE ANSWER — SKIPPING AI (no credits)')
            setCoachTrack({
              goal: instruction,
              lastTargetName: match.label,
              steps: [
                `Open “${match.label}” (double-click the icon, or select it and press Enter).`,
                `Confirm “${match.label}” is open and ready — say “done” when you’re there.`
              ],
              stepIndex: 0
            })
            const decision = buildLocateDecision(match, absoluteMarks, allowProposedActions)
            decision.usedLocalAnswer = true
            decision.guidance = [
              decision.guidance,
              '',
              'When you’ve done this, say “done” or “next” and I’ll continue.'
            ].join('\n')
            if (settings.debugScreenIntel) {
              decision.debugMapText = formatDebugMap(map, instruction, match, plan.intent, true)
              console.log(decision.debugMapText)
            }
            return finish(decision)
          }
        } else if (pointing) {
          if (!deps.ai.isConfigured()) {
            return {
              ok: false,
              error:
                'Could not find that on screen with Windows UI data. Add OPENAI_API_KEY for vision fallback.',
              capture,
              memoryTurnCount,
              mode
            }
          }
          if (!visionCapture) {
            visionCapture = burnCoordinateGrid(capture)
          }
          const localized = await localizeTargetInRegion({
            capture,
            instruction,
            sizePhysical: map.screen.sizePhysical,
            displayOriginPhysical: displayOriginPhysical(capture),
            model: settings.model,
            localize: async (input) => {
              if (!deps.ai.localizeInCrop) return null
              return deps.ai.localizeInCrop(input)
            }
          })

          if (localized) {
            match = {
              ...localized,
              confidence: Math.min(0.55, localized.confidence),
              reason: (localized.reason || 'vision') + ' (weak fallback)',
              targetType: 'unknown',
              matchKind: 'vision'
            }
            logTargetPipeline(match)
            resolvedLabel = match.label
            targetSource = 'vision'
            absoluteMarks = marksFromMatch(match)
            console.log(
              'VISION FALLBACK USED (no valid structural target)\nsource: vision\nconfidence: ≤0.55'
            )
          }
        }

        if (settings.debugScreenIntel && map) {
          debugMapText = formatDebugMap(
            map,
            instruction,
            match,
            plan.intent,
            Boolean(absoluteMarks?.length && match && match.source !== 'vision')
          )
          console.log(debugMapText)
        }
      } catch (err) {
        console.warn('Screen intel failed:', err)
      }

      // From here we need the model
      if (!deps.ai.isConfigured()) {
        return {
          ok: false,
          error:
            'OpenAI API key is not configured. Put OPENAI_API_KEY in .env and restart Peeki.',
          capture,
          memoryTurnCount,
          mode
        }
      }

      if (!visionCapture && (!absoluteMarks || absoluteMarks.length === 0)) {
        visionCapture = burnCoordinateGrid(capture)
      }
      const useGridVision = !absoluteMarks || absoluteMarks.length === 0

      const decision = await deps.ai.analyzeScreen({
        instruction,
        capture: useGridVision ? visionCapture! : capture,
        model: settings.model,
        allowProposedActions,
        recentTurns,
        mode,
        elementMapText,
        resolvedTargetLabel: resolvedLabel
      })

      if (!decision.guidance.trim()) {
        return {
          ok: false,
          error: 'The AI returned empty guidance. Please try again.',
          capture,
          memoryTurnCount,
          mode
        }
      }

      if (deps.permissions.requiresConfirmation(decision.proposedActions)) {
        decision.needsConfirmation = true
      }

      if (
        decision.confidence === 0 &&
        decision.screenSummary.toLowerCase().startsWith('unable to analyze')
      ) {
        return { ok: false, error: decision.guidance, capture, memoryTurnCount, mode }
      }

      if (mode === 'step' && decision.steps.length === 0 && decision.nextStep) {
        decision.steps = [decision.nextStep]
      }

      // Safety net: never keep vision coords when UIA already has the named target
      // Skip for open coaching — we must not snap "help me design" onto Photoshop chrome
      if (!coaching && map && (!absoluteMarks || absoluteMarks.length === 0)) {
        const snap =
          resolveTarget(map, instruction) ||
          (resolvedLabel ? resolveTarget(map, `find ${resolvedLabel}`) : null)
        if (snap && snap.source !== 'vision' && snap.confidence >= 0.5) {
          match = snap
          absoluteMarks = marksFromMatch(snap)
          targetSource = snap.source
          decision.highlights = []
          console.log(
            `SNAPPED TO UIA (rejected vision)\nname: ${snap.label}\nsource: ${snap.source}\nbounds: ${snap.bounds.x},${snap.bounds.y},${snap.bounds.width},${snap.bounds.height}`
          )
        }
      }

      if (coaching) {
        decision.highlights = filterCoachingHighlights(instruction, decision.highlights, map)
        if (decision.highlights.length === 0) {
          console.log('COACHING: no tool/layer highlight — guidance/steps only (correct for design help)')
        }
      }

      if (decision.steps.length > 0) {
        setCoachTrack({
          goal: decision.userGoal || instruction,
          steps: decision.steps,
          stepIndex: 0,
          lastTargetName: match?.label || absoluteMarks?.[0]?.label,
          lastScreenSummary: decision.screenSummary
        })
      }

      if (absoluteMarks && absoluteMarks.length > 0) {
        // Strong/structured match wins — vision must not replace coordinates
        decision.absoluteMarks = absoluteMarks
        decision.targetSource = targetSource as typeof decision.targetSource
        decision.highlights = []
        if (!decision.nextStep) {
          decision.nextStep = `Here it is — “${absoluteMarks[0]?.label ?? 'this'}”.`
        }
        if (pointing && !/here it is/i.test(decision.guidance)) {
          decision.guidance = `Here it is.\n\n${decision.guidance}`
        }

        // Prefer UIA Invoke / verified bounds click over vision guesses
        if (
          allowProposedActions &&
          match &&
          isStrongMatch(match) &&
          match.source !== 'vision' &&
          decision.proposedActions.length === 0
        ) {
          const c = {
            x: Math.round(match.bounds.x + match.bounds.width / 2),
            y: Math.round(match.bounds.y + match.bounds.height / 2)
          }
          decision.proposedActions = [
            {
              id: 'resolved-click',
              type: 'click',
              description: `Click “${match.label}”`,
              risk: 'low',
              uiaName: match.label,
              physicalBounds: match.bounds,
              physicalX: c.x,
              physicalY: c.y,
              targetSource: match.source as 'uia' | 'ocr' | 'desktop' | 'taskbar'
            }
          ]
          decision.needsConfirmation = true
        }
      } else {
        // Full-screen vision fallback only when UIA/OCR/localizer failed
        if (decision.highlights.length > 0) {
          const refined: typeof decision.highlights = []
          for (const mark of decision.highlights.slice(0, 3)) {
            try {
              refined.push(
                await deps.ai.refineHighlight({
                  capture,
                  highlight: mark,
                  labelHint: mark.label || instruction,
                  model: settings.model
                })
              )
            } catch {
              refined.push(mark)
            }
          }
          if (decision.highlights.length > 3) {
            refined.push(...decision.highlights.slice(3))
          }
          decision.highlights = refined
        }

        const visionMarks: AbsoluteMark[] = decision.highlights.map((h) => ({
          id: h.id,
          label: h.label,
          style: 'rect' as const,
          bounds: normalizedToPhysical(h.x, h.y, h.width, h.height, {
            displayBounds: capture.displayBounds,
            coordMap: capture.coordMap,
            scaleFactor: 1
          })
        }))
        if (visionMarks.length > 0) {
          decision.absoluteMarks = visionMarks
          decision.targetSource = 'vision'
          for (const m of visionMarks) {
            logTargetPipeline({
              source: 'vision',
              confidence: decision.confidence || 0.5,
              label: m.label || 'vision',
              bounds: m.bounds,
              reason: 'full-screen-vision-fallback'
            })
          }
        }
      }

      if (debugMapText) {
        decision.debugMapText = debugMapText
      }

      return finish(decision)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI analysis failed'
      return { ok: false, error: message, capture, memoryTurnCount, mode }
    }
  }

  return { run }
}

export type { AgentModule } from './types'
