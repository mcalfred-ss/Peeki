/**
 * Shared contracts for the Peeki modular monolith.
 * All modules speak through these types — no cross-module internals.
 */

export type ActionType = 'click' | 'type' | 'scroll' | 'hotkey' | 'open_app' | 'wait'

export type ActionRisk = 'low' | 'medium' | 'high'

export type CoachMode = 'auto' | 'normal' | 'step'

/** Soft prompt when another mode would help the user more. */
export type ModeSuggestion = {
  recommended: 'normal' | 'step'
  reason: string
  /** Show Switch / Keep buttons in the ask bar */
  askUser: boolean
  /** Also suggest turning Act on (click/type) */
  suggestAct?: boolean
  /** Suggest staying awake as live coach */
  suggestOnDuty?: boolean
}

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
  /** Absolute physical-pixel click (preferred when from UIA/OCR) */
  physicalX?: number
  physicalY?: number
  /** Verified physical bounds for InvokePattern / center-click */
  physicalBounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  /** UIA element name for InvokePattern */
  uiaName?: string
  /** How coordinates were obtained — vision-only must not auto-click */
  targetSource?: 'uia' | 'ocr' | 'vision' | 'desktop' | 'taskbar'
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

export type HighlightsShowPayload = {
  highlights: ScreenHighlight[]
  /** Only show marks for this step index when set */
  stepIndex?: number
  autoHideMs?: number
  /** Prefer the capture's display bounds for correct DPI mapping */
  displayBounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  /** Screenshot content rect inside displayBounds (DIP) */
  coordMap?: {
    offsetX: number
    offsetY: number
    width: number
    height: number
  }
  /**
   * Preferred: absolute physical-pixel marks from UI Automation / OCR.
   * When present, these are painted instead of (or in addition to) normalized highlights.
   */
  absoluteMarks?: import('./screenIntel').AbsoluteMark[]
  /** When true, show A/B coord markers and verbose overlay diagnostics */
  debugOverlay?: boolean
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
  /** Absolute physical-pixel marks from UIA/OCR (preferred over highlights) */
  absoluteMarks?: import('./screenIntel').AbsoluteMark[]
  /** How the primary target was resolved */
  targetSource?: 'uia' | 'ocr' | 'vision' | 'desktop' | 'taskbar'
  /** Developer debug dump of the screen element map */
  debugMapText?: string
  /** When set, ask bar can offer switching coach mode */
  modeSuggestion?: ModeSuggestion
  /** True when answered from UIA/map without an OpenAI call */
  usedLocalAnswer?: boolean
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
  /** Display bounds in DIP used for overlay mapping */
  displayBounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  /**
   * Where the screenshot content sits inside displayBounds (DIP).
   * Used when capture aspect ≠ display aspect so marks stay aligned.
   */
  coordMap?: {
    offsetX: number
    offsetY: number
    width: number
    height: number
  }
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
  /** Show screen-element-map debug dump in the coach panel */
  debugScreenIntel: boolean
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
  maxCaptureWidth: 1920,
  sendScreenByDefault: true,
  allowProposedActions: false,
  overlayVisible: true,
  overlayPosition: null,
  coachMode: 'auto',
  privacyBlurEnabled: false,
  voiceReplyEnabled: true,
  watchEnabled: false,
  watchIntervalSec: 12,
  computerControlEnabled: true,
  debugScreenIntel: false
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
  LOOKING_STATE: 'looking:state',
  WATCH_TOGGLE: 'watch:toggle',
  WATCH_GET: 'watch:get',
  ORB_MENU: 'orb:menu',
  ORB_DONE: 'orb:done',
  WATCH_STATE: 'watch:state',
  WATCH_NUDGE: 'watch:nudge',
  SKILLS_LIST: 'skills:list',
  SKILLS_SAVE: 'skills:save',
  SKILLS_DELETE: 'skills:delete',
  SKILLS_GET: 'skills:get',
  HISTORY_LIST: 'history:list',
  HISTORY_CLEAR: 'history:clear',
  UIA_DIAGNOSE_DESKTOP: 'uia:diagnose-desktop',
  CALIBRATE_PHYSICAL: 'calib:physical'
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
  activeGoal?: string | null
}

export type WatchNudgePayload = {
  guidance: string
  nextStep?: string
  screenSummary: string
  highlights: ScreenHighlight[]
  absoluteMarks?: import('./screenIntel').AbsoluteMark[]
  proposedActions: ProposedAction[]
  confidence: number
}

export type OverlayDragPayload = {
  screenX: number
  screenY: number
}

export type AskBarLayout = 'ask' | 'coach'

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

