import { screen } from 'electron'
import type {
  ActionExecutionRequest,
  ActionExecutionResult,
  ProposedAction
} from '../shared'
import type { ActionModule } from './types'
import type { PermissionModule } from '../permissions/types'
import { mouseClickAt, sendHotkey, scrollAt, typeText } from './windowsInput'

function riskRank(risk: ProposedAction['risk']): number {
  switch (risk) {
    case 'low':
      return 1
    case 'medium':
      return 2
    case 'high':
      return 3
    default: {
      const _exhaustive: never = risk
      return _exhaustive
    }
  }
}

function resolveClickPoint(action: ProposedAction): { x: number; y: number } | null {
  if (typeof action.x === 'number' && typeof action.y === 'number') {
    const display = screen.getPrimaryDisplay().bounds
    return {
      x: display.x + action.x * display.width,
      y: display.y + action.y * display.height
    }
  }
  return null
}

async function runOne(action: ProposedAction): Promise<void> {
  switch (action.type) {
    case 'click': {
      const point = resolveClickPoint(action)
      if (!point) {
        throw new Error(`Click action "${action.description}" is missing screen coordinates.`)
      }
      await mouseClickAt(point.x, point.y)
      return
    }
    case 'type': {
      if (!action.value) {
        throw new Error(`Type action "${action.description}" is missing text.`)
      }
      await typeText(action.value)
      return
    }
    case 'hotkey': {
      if (!action.value) {
        throw new Error(`Hotkey action "${action.description}" is missing key sequence.`)
      }
      await sendHotkey(action.value)
      return
    }
    case 'scroll': {
      const point = resolveClickPoint(action) ?? {
        x: screen.getPrimaryDisplay().bounds.x + screen.getPrimaryDisplay().bounds.width / 2,
        y: screen.getPrimaryDisplay().bounds.y + screen.getPrimaryDisplay().bounds.height / 2
      }
      const amount = Number(action.value ?? '120')
      await scrollAt(point.x, point.y, Number.isFinite(amount) ? amount : 120)
      return
    }
    case 'wait': {
      const ms = Math.min(5000, Math.max(100, Number(action.value ?? '400')))
      await new Promise((r) => setTimeout(r, ms))
      return
    }
    case 'open_app': {
      throw new Error('open_app is not enabled yet — use click/type/hotkey for now.')
    }
    default: {
      const _exhaustive: never = action.type
      throw new Error(`Unsupported action: ${_exhaustive}`)
    }
  }
}

/**
 * Computer-control module — runs only after explicit user confirmation.
 */
export function createActionExecutor(deps: {
  permissions: PermissionModule
  getEnabled: () => boolean
}): ActionModule {
  function isEnabled(): boolean {
    return deps.getEnabled()
  }

  async function execute(request: ActionExecutionRequest): Promise<ActionExecutionResult> {
    const { actions, confirmed } = request

    if (actions.length === 0) {
      return {
        ok: true,
        executed: [],
        skipped: [],
        message: 'No actions to run.'
      }
    }

    try {
      deps.permissions.assertConfirmed(confirmed, actions)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Confirmation required'
      return {
        ok: false,
        executed: [],
        skipped: actions.map((a) => a.id),
        message
      }
    }

    if (!deps.getEnabled()) {
      return {
        ok: false,
        executed: [],
        skipped: actions.map((a) => a.id),
        message: 'Computer control is turned off in settings.'
      }
    }

    const maxRisk = actions.reduce((max, a) => Math.max(max, riskRank(a.risk)), 0)
    if (maxRisk >= 3 && actions.length > 1) {
      return {
        ok: false,
        executed: [],
        skipped: actions.map((a) => a.id),
        message: 'High-risk actions must be confirmed one at a time.'
      }
    }

    const executed: string[] = []
    const skipped: string[] = []

    for (const action of actions) {
      try {
        await runOne(action)
        executed.push(action.id)
        await new Promise((r) => setTimeout(r, 120))
      } catch (error) {
        skipped.push(action.id)
        const message = error instanceof Error ? error.message : 'Action failed'
        const remaining = actions
          .slice(executed.length + skipped.length)
          .map((a) => a.id)
        return {
          ok: false,
          executed,
          skipped: [...skipped, ...remaining],
          message
        }
      }
    }

    return {
      ok: true,
      executed,
      skipped,
      message: `Ran ${executed.length} action${executed.length === 1 ? '' : 's'}.`
    }
  }

  return {
    execute,
    isEnabled
  }
}

export type { ActionModule } from './types'
