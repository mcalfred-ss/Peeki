/**
 * Module barrel — documents the modular monolith boundaries.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │                     Peeki (single app)                  │
 * │  shared → capture → ai → agent → actions/permissions    │
 * └─────────────────────────────────────────────────────────┘
 *
 * Rules:
 * - Modules depend inward on `shared` contracts.
 * - `agent` orchestrates; it does not own capture/AI/action internals.
 * - UI talks only via IPC to the composition root (main process).
 */

export * as shared from './shared'
export * as capture from './capture'
export * as ai from './ai'
export * as agent from './agent'
export * as actions from './actions'
export * as permissions from './permissions'
export * as overlay from './overlay'
export * as memory from './memory'
export * as privacy from './privacy'
export * as watch from './watch'
export * as skills from './skills'
export * as history from './history'
