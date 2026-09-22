import type { AppSettings, ProposedAction } from '../shared'

export interface PermissionModule {
  canProposeActions(settings: AppSettings): boolean
  requiresConfirmation(actions: ProposedAction[]): boolean
  assertConfirmed(confirmed: boolean, actions: ProposedAction[]): void
}
