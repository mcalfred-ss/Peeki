/**
 * Shared contracts for the Peeki modular monolith.
 * All modules speak through these types — no cross-module internals.
 */

export type ActionType = 'click' | 'type' | 'scroll' | 'hotkey' | 'open_app' | 'wait'

export type ActionRisk = 'low' | 'medium' | 'high'

export type CoachMode = 'normal' | 'step'

export type ProposedAction = {
  id: string
  type: ActionType
  description: string
  target?: string
  value?: string
  risk: ActionRisk
  /** Normalized click point 0..1 (for click actions) */
  x?: number
  y?: number
}

/** Normalized highlight box (0..1 relative to the screenshot) */
export type ScreenHighlight = {
  id: string
  x: number
  y: number
  width: number
  height: number
  label?: string
  /** When step mode returns multiple steps, which step this mark belongs to */
  stepIndex?: number
}

export type AgentDecision = {
  screenSummary: string
  userGoal: string
  guidance: string
  nextStep?: string
  /** Ordered coach steps (used heavily in step mode) */
  steps: string[]
  highlights: ScreenHighlight[]
  proposedActions: ProposedAction[]
  needsConfirmation: boolean
  confidence: number
}

export type ScreenCapture = {
  id: string
  /** image data URL (jpeg/png base64) */
  dataUrl: string
  width: number
  height: number
  displayId: string
  capturedAt: string
  /** True when privacy blur was applied before AI */
  privacyApplied?: boolean
}

export type AgentRunRequest = {
  instruction: string
  captureId?: string
  allowProposedActions?: boolean
  mode?: CoachMode
}

export type AgentRunResult = {
  ok: true
  decision: AgentDecision
  capture: ScreenCapture
  memoryTurnCount: number
  mode: CoachMode
} | {
  ok: false
  error: string
  capture?: ScreenCapture
  memoryTurnCount?: number
  mode?: CoachMode
}

export type MemoryTurnView = {
  id: string
  instruction: string
  guidance: string
  createdAt: string
}

export type MemorySnapshot = {
  turnCount: number
  recent: MemoryTurnView[]
}

export type ActionExecutionRequest = {
  actions: ProposedAction[]
  confirmed: boolean
}

export type ActionExecutionResult = {
  ok: boolean
  executed: string[]
  skipped: string[]
  message: string
}

export type OverlayPosition = {
  x: number
  y: number
}

export type PrivacyZone = {
  id: string
  /** 0..1 relative to capture */
  x: number
  y: number
  width: number
  height: number
  label?: string
}

export type AppSettings = {
  model: string
  maxCaptureWidth: number
  sendScreenByDefault: boolean
  allowProposedActions: boolean
  overlayVisible: boolean
  overlayPosition: OverlayPosition | null
  /** Ask-bar coach mode default */
  coachMode: CoachMode
  /** Blur sensitive regions before sending screenshots to the AI */
  privacyBlurEnabled: boolean
  /** Speak guidance aloud after answers */
  voiceReplyEnabled: boolean
  /** Continuous light awareness loop */
  watchEnabled: boolean
  /** Seconds between watch checks (min 8) */
  watchIntervalSec: number
  /** Allow OS click/type/scroll after explicit confirmation */
  computerControlEnabled: boolean
}

export const DEFAULT_PRIVACY_ZONES: PrivacyZone[] = [
  {
    id: 'taskbar',
    x: 0,
    y: 0.92,
    width: 1,
    height: 0.08,
    label: 'Taskbar'
  },
  {
    id: 'notify',
    x: 0.72,
    y: 0,
    width: 0.28,
    height: 0.28,
    label: 'Notifications'
  },
  {
    id: 'password-band',
    x: 0.22,
    y: 0.38,
    width: 0.56,
    height: 0.22,
    label: 'Sign-in area'
  }
]

export const DEFAULT_SETTINGS: AppSettings = {
  model: 'gpt-4.1-mini',
  maxCaptureWidth: 1400,
  sendScreenByDefault: true,
  allowProposedActions: false,
  overlayVisible: true,
  overlayPosition: null,
  coachMode: 'normal',
  privacyBlurEnabled: false,
  voiceReplyEnabled: true,
  watchEnabled: false,
  watchIntervalSec: 15,
  computerControlEnabled: true
}

export const TEACH_PRESETS = [
  {
    id: 'explain',
    label: 'Explain',
    instruction: 'Explain what I am looking at on this screen in plain language. What app is this, and what is the main thing I can do here?'
  },
  {
    id: 'safe',
    label: 'Safe clicks',
    instruction: 'What is safe to click on this screen, and what should I avoid? Point out the important buttons and any risky actions.'
  },
  {
    id: 'next',
    label: 'Next step',
    instruction: 'Based on this screen, what is the single best next step I should take right now? Be specific about the UI control.'
  }
] as const

/** IPC channel names — single source of truth */
export const IpcChannels = {
  AGENT_RUN: 'agent:run',
  CAPTURE_SCREEN: 'capture:screen',
  ACTIONS_EXECUTE: 'actions:execute',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  APP_STATUS: 'app:status',
  OVERLAY_DRAG: 'overlay:drag',
  OVERLAY_DRAG_END: 'overlay:drag-end',
  OVERLAY_CLICK: 'overlay:click',
  OVERLAY_SET_VISIBLE: 'overlay:set-visible',
  ASK_BAR_SHOW: 'ask-bar:show',
  ASK_BAR_HIDE: 'ask-bar:hide',
  ASK_BAR_TOGGLE: 'ask-bar:toggle',
  ASK_BAR_LAYOUT: 'ask-bar:layout',
  MEMORY_GET: 'memory:get',
  MEMORY_CLEAR: 'memory:clear',
  HIGHLIGHTS_SHOW: 'highlights:show',
  HIGHLIGHTS_HIDE: 'highlights:hide',
  HIGHLIGHTS_SET_STEP: 'highlights:set-step',
  WATCH_TOGGLE: 'watch:toggle',
  WATCH_GET: 'watch:get',
  ORB_MENU: 'orb:menu',
  WATCH_STATE: 'watch:state',
  WATCH_NUDGE: 'watch:nudge',
  SKILLS_LIST: 'skills:list',
  SKILLS_SAVE: 'skills:save',
  SKILLS_DELETE: 'skills:delete',
  SKILLS_GET: 'skills:get',
  HISTORY_LIST: 'history:list',
  HISTORY_CLEAR: 'history:clear'
} as const

export type AppStatus = {
  hasApiKey: boolean
  actionsEnabled: boolean
  version: string
  overlayVisible: boolean
  memoryTurnCount: number
  privacyBlurEnabled: boolean
  coachMode: CoachMode
  watchEnabled: boolean
  computerControlEnabled: boolean
}

export type WatchStatus = {
  enabled: boolean
  intervalSec: number
  lastCheckedAt: string | null
  lastNudgeAt: string | null
}

export type WatchNudgePayload = {
  guidance: string
  nextStep?: string
  screenSummary: string
  highlights: ScreenHighlight[]
  proposedActions: ProposedAction[]
  confidence: number
}

export type OverlayDragPayload = {
  screenX: number
  screenY: number
}

export type AskBarLayout = 'ask' | 'coach'

export type HighlightsShowPayload = {
  highlights: ScreenHighlight[]
  /** Only show marks for this step index when set */
  stepIndex?: number
  autoHideMs?: number
}

/** Saved guided path — step text + optional highlight targets */
export type SavedSkill = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  instruction: string
  guidance: string
  steps: string[]
  highlights: ScreenHighlight[]
  screenSummary?: string
}

export type SaveSkillRequest = {
  name: string
  instruction: string
  guidance: string
  steps: string[]
  highlights?: ScreenHighlight[]
  screenSummary?: string
}

/** Local session log entry (text only — no screenshots) */
export type HistoryEntry = {
  id: string
  createdAt: string
  instruction: string
  guidance: string
  nextStep?: string
  screenSummary?: string
  mode: CoachMode
  stepCount: number
}

