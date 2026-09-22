import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type ActionExecutionRequest,
  type ActionExecutionResult,
  type AgentRunRequest,
  type AgentRunResult,
  type AppSettings,
  type AppStatus,
  type AskBarLayout,
  type HighlightsShowPayload,
  type HistoryEntry,
  type MemorySnapshot,
  type OverlayDragPayload,
  type OverlayPosition,
  type SavedSkill,
  type SaveSkillRequest,
  type ScreenCapture,
  type ScreenHighlight,
  type WatchNudgePayload,
  type WatchStatus
} from '../../modules/shared'

const ASK_BAR_FOCUS_EVENT = 'ask-bar:focus-input'
const ASK_BAR_LAYOUT_EVENT = 'ask-bar:layout'
const HIGHLIGHTS_PAINT_EVENT = 'highlights:paint'

const peekiApi = {
  getStatus: (): Promise<AppStatus> => ipcRenderer.invoke(IpcChannels.APP_STATUS),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),

  updateSettings: (partial: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_UPDATE, partial),

  captureScreen: (): Promise<ScreenCapture> =>
    ipcRenderer.invoke(IpcChannels.CAPTURE_SCREEN),

  runAgent: (request: AgentRunRequest): Promise<AgentRunResult> =>
    ipcRenderer.invoke(IpcChannels.AGENT_RUN, request),

  executeActions: (request: ActionExecutionRequest): Promise<ActionExecutionResult> =>
    ipcRenderer.invoke(IpcChannels.ACTIONS_EXECUTE, request),

  dragOverlay: (payload: OverlayDragPayload): void => {
    ipcRenderer.send(IpcChannels.OVERLAY_DRAG, payload)
  },

  endOverlayDrag: (): Promise<OverlayPosition | null> =>
    ipcRenderer.invoke(IpcChannels.OVERLAY_DRAG_END),

  clickOverlay: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IpcChannels.OVERLAY_CLICK),

  setOverlayVisible: (visible: boolean): Promise<AppSettings> =>
    ipcRenderer.invoke(IpcChannels.OVERLAY_SET_VISIBLE, visible),

  showAskBar: (): Promise<void> => ipcRenderer.invoke(IpcChannels.ASK_BAR_SHOW),

  hideAskBar: (): Promise<void> => ipcRenderer.invoke(IpcChannels.ASK_BAR_HIDE),

  toggleAskBar: (): Promise<void> => ipcRenderer.invoke(IpcChannels.ASK_BAR_TOGGLE),

  setAskBarLayout: (layout: AskBarLayout): Promise<AskBarLayout> =>
    ipcRenderer.invoke(IpcChannels.ASK_BAR_LAYOUT, layout),

  getMemory: (): Promise<MemorySnapshot> => ipcRenderer.invoke(IpcChannels.MEMORY_GET),

  clearMemory: (): Promise<MemorySnapshot> => ipcRenderer.invoke(IpcChannels.MEMORY_CLEAR),

  showHighlights: (payload: HighlightsShowPayload): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.HIGHLIGHTS_SHOW, payload),

  hideHighlights: (): Promise<void> => ipcRenderer.invoke(IpcChannels.HIGHLIGHTS_HIDE),

  setHighlightStep: (stepIndex: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.HIGHLIGHTS_SET_STEP, stepIndex),

  getWatchStatus: (): Promise<WatchStatus> => ipcRenderer.invoke(IpcChannels.WATCH_GET),

  toggleWatch: (enabled?: boolean): Promise<WatchStatus> =>
    ipcRenderer.invoke(IpcChannels.WATCH_TOGGLE, enabled),

  openOrbMenu: (): Promise<void> => ipcRenderer.invoke(IpcChannels.ORB_MENU),

  /** Floating Done — tells Peeki the tip is finished and asks what is next */
  reportDone: (): Promise<AgentRunResult> => ipcRenderer.invoke(IpcChannels.ORB_DONE),

  listSkills: (): Promise<SavedSkill[]> => ipcRenderer.invoke(IpcChannels.SKILLS_LIST),

  getSkill: (id: string): Promise<SavedSkill | null> =>
    ipcRenderer.invoke(IpcChannels.SKILLS_GET, id),

  saveSkill: (request: SaveSkillRequest): Promise<SavedSkill> =>
    ipcRenderer.invoke(IpcChannels.SKILLS_SAVE, request),

  deleteSkill: (id: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannels.SKILLS_DELETE, id),

  listHistory: (limit?: number): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke(IpcChannels.HISTORY_LIST, limit),

  clearHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke(IpcChannels.HISTORY_CLEAR),

  onAskBarFocus: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on(ASK_BAR_FOCUS_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(ASK_BAR_FOCUS_EVENT, listener)
    }
  },

  onAskBarLayout: (callback: (layout: AskBarLayout) => void): (() => void) => {
    const listener = (_event: unknown, layout: AskBarLayout): void => {
      callback(layout)
    }
    ipcRenderer.on(ASK_BAR_LAYOUT_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(ASK_BAR_LAYOUT_EVENT, listener)
    }
  },

  onHighlightsPaint: (
    callback: (payload: {
      highlights: ScreenHighlight[]
      display: { width: number; height: number } | null
      coordMap?: {
        offsetX: number
        offsetY: number
        width: number
        height: number
      }
      displayOrigin?: { x: number; y: number }
      absoluteMarks?: Array<{
        left: number
        top: number
        width: number
        height: number
        label?: string
        style: 'rect' | 'circle' | 'arrow'
        debugKind?: 'a-physical' | 'b-already-dip' | 'normal'
        id?: string
      }>
      debugOverlay?: boolean
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: {
        highlights: ScreenHighlight[]
        display: { width: number; height: number } | null
        coordMap?: {
          offsetX: number
          offsetY: number
          width: number
          height: number
        }
        displayOrigin?: { x: number; y: number }
        absoluteMarks?: Array<{
          left: number
          top: number
          width: number
          height: number
          label?: string
          style: 'rect' | 'circle' | 'arrow'
          debugKind?: 'a-physical' | 'b-already-dip' | 'normal'
          id?: string
        }>
        debugOverlay?: boolean
      }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on(HIGHLIGHTS_PAINT_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(HIGHLIGHTS_PAINT_EVENT, listener)
    }
  },

  onLookingState: (callback: (payload: { active: boolean }) => void): (() => void) => {
    const listener = (_event: unknown, payload: { active: boolean }): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.LOOKING_STATE, listener)
    return () => {
      ipcRenderer.removeListener(IpcChannels.LOOKING_STATE, listener)
    }
  },

  onWatchState: (callback: (payload: { enabled: boolean }) => void): (() => void) => {
    const listener = (_event: unknown, payload: { enabled: boolean }): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.WATCH_STATE, listener)
    return () => {
      ipcRenderer.removeListener(IpcChannels.WATCH_STATE, listener)
    }
  },

  onWatchNudge: (callback: (payload: WatchNudgePayload) => void): (() => void) => {
    const listener = (_event: unknown, payload: WatchNudgePayload): void => {
      callback(payload)
    }
    ipcRenderer.on(IpcChannels.WATCH_NUDGE, listener)
    return () => {
      ipcRenderer.removeListener(IpcChannels.WATCH_NUDGE, listener)
    }
  }
}

contextBridge.exposeInMainWorld('peeki', peekiApi)

export type PeekiApi = typeof peekiApi
