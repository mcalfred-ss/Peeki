import type {
  AgentRunRequest,
  AgentRunResult,
  AppSettings,
  CoachMode
} from '../shared'
import type { CaptureModule } from '../capture'
import type { AiModule } from '../ai'
import type { PermissionModule } from '../permissions/types'
import type { MemoryModule } from '../memory/types'
import type { PrivacyModule } from '../privacy'
import type { HistoryModule } from '../history'
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

function resolveMode(request: AgentRunRequest, settings: AppSettings): CoachMode {
  return request.mode ?? settings.coachMode ?? 'normal'
}

export function createAgentOrchestrator(deps: AgentDeps): AgentModule {
  async function run(request: AgentRunRequest): Promise<AgentRunResult> {
    const settings = deps.getSettings()
    const instruction = request.instruction.trim()
    const memoryTurnCount = deps.memory.size()
    const mode = resolveMode(request, settings)

    if (!instruction) {
      return { ok: false, error: 'Please enter an instruction.', memoryTurnCount, mode }
    }

    if (!deps.ai.isConfigured()) {
      return {
        ok: false,
        error:
          'OpenAI API key is not configured. Put OPENAI_API_KEY in .env and restart Peeki.',
        memoryTurnCount,
        mode
      }
    }

    let capture
    try {
      await deps.beforeCapture?.()
      await sleep(CAPTURE_SETTLE_MS)
      capture = await deps.capture.capturePrimaryDisplay(settings.maxCaptureWidth)
      if (settings.privacyBlurEnabled) {
        capture = deps.privacy.applyBlur(capture)
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

    const allowProposedActions =
      Boolean(request.allowProposedActions) &&
      deps.permissions.canProposeActions(settings)

    const recentTurns = deps.memory.getRecent(MEMORY_CONTEXT_TURNS)

    try {
      const decision = await deps.ai.analyzeScreen({
        instruction,
        capture,
        model: settings.model,
        allowProposedActions,
        recentTurns,
        mode
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

      // In step mode, ensure we have usable steps
      if (mode === 'step' && decision.steps.length === 0 && decision.nextStep) {
        decision.steps = [decision.nextStep]
      }

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
        ok: true,
        decision,
        capture,
        memoryTurnCount: deps.memory.size(),
        mode
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI analysis failed'
      return { ok: false, error: message, capture, memoryTurnCount, mode }
    }
  }

  return { run }
}

export type { AgentModule } from './types'
