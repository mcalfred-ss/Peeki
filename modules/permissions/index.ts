import type { ProposedAction, AppSettings } from '../shared'
import type { PermissionModule } from './types'

export function createPermissionService(): PermissionModule {
  function canProposeActions(settings: AppSettings): boolean {
    return settings.allowProposedActions === true
  }

  function requiresConfirmation(actions: ProposedAction[]): boolean {
    return actions.length > 0
  }

  function assertConfirmed(confirmed: boolean, actions: ProposedAction[]): void {
    if (actions.length === 0) return
    if (!confirmed) {
      throw new Error('User confirmation is required before running computer actions.')
    }
  }

  return {
    canProposeActions,
    requiresConfirmation,
    assertConfirmed
  }
}

export type { PermissionModule } from './types'
