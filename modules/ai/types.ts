import type { AgentDecision, CoachMode, ScreenCapture } from '../shared'
import type { MemoryTurn } from '../memory/types'

export type VisionAnalyzeInput = {
  instruction: string
  capture: ScreenCapture
  model: string
  allowProposedActions: boolean
  recentTurns?: MemoryTurn[]
  mode?: CoachMode
}

export interface AiModule {
  analyzeScreen(input: VisionAnalyzeInput): Promise<AgentDecision>
  isConfigured(): boolean
}
