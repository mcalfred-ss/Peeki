import type { AgentDecision, CoachMode, ScreenCapture, ScreenHighlight } from '../shared'
import type { MemoryTurn } from '../memory/types'

export type VisionAnalyzeInput = {
  instruction: string
  capture: ScreenCapture
  model: string
  allowProposedActions: boolean
  recentTurns?: MemoryTurn[]
  mode?: CoachMode
  /** Precomputed UI Automation + OCR summary for the model */
  elementMapText?: string
  /** If set, model should not invent coordinates for this already-resolved target */
  resolvedTargetLabel?: string
}

export type RefineHighlightInput = {
  capture: ScreenCapture
  highlight: ScreenHighlight
  labelHint: string
  model: string
}

export type LocalizeInCropInput = {
  dataUrl: string
  width: number
  height: number
  labelHint: string
  model?: string
}

export type LocalizeInCropResult = {
  cx: number
  cy: number
  found: boolean
}

export interface AiModule {
  analyzeScreen(input: VisionAnalyzeInput): Promise<AgentDecision>
  refineHighlight(input: RefineHighlightInput): Promise<ScreenHighlight>
  /** Locate a target inside an already-cropped region (normalized 0..1 in crop). */
  localizeInCrop(input: LocalizeInCropInput): Promise<LocalizeInCropResult | null>
  isConfigured(): boolean
}
