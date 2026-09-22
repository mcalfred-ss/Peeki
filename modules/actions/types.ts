import type {
  ActionExecutionRequest,
  ActionExecutionResult
} from '../shared'

export interface ActionModule {
  /**
   * MVP: refuses to run unless confirmed, and still stubs execution.
   * Future: click/type/scroll via OS automation after confirmation.
   */
  execute(request: ActionExecutionRequest): Promise<ActionExecutionResult>
  isEnabled(): boolean
}
