import type {
  AgentRunRequest,
  AgentRunResult
} from '../shared'

/**
 * Agent orchestration module — the heart of the modular monolith.
 * Coordinates capture → AI → decision → (optional) gated actions.
 */
export interface AgentModule {
  run(request: AgentRunRequest): Promise<AgentRunResult>
}
