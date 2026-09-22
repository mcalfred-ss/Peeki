import { randomUUID } from 'crypto'
import type { MemoryModule, MemoryTurn } from './types'

export type CreateMemoryOptions = {
  /** How many recent turns to keep (text only — no screenshots) */
  maxTurns?: number
}

export function createSessionMemory(options?: CreateMemoryOptions): MemoryModule {
  const maxTurns = Math.max(1, options?.maxTurns ?? 5)
  const turns: MemoryTurn[] = []

  function add(turn: Omit<MemoryTurn, 'id' | 'createdAt'> & Partial<Pick<MemoryTurn, 'id' | 'createdAt'>>): MemoryTurn {
    const saved: MemoryTurn = {
      id: turn.id ?? randomUUID(),
      createdAt: turn.createdAt ?? new Date().toISOString(),
      instruction: turn.instruction.trim(),
      screenSummary: turn.screenSummary.trim(),
      userGoal: turn.userGoal.trim(),
      guidance: turn.guidance.trim(),
      nextStep: turn.nextStep?.trim() || undefined
    }

    turns.push(saved)
    while (turns.length > maxTurns) {
      turns.shift()
    }
    return saved
  }

  function getRecent(limit = maxTurns): MemoryTurn[] {
    const n = Math.max(0, limit)
    return turns.slice(-n).map((t) => ({ ...t }))
  }

  function clear(): void {
    turns.length = 0
  }

  function size(): number {
    return turns.length
  }

  return {
    add,
    getRecent,
    clear,
    size
  }
}

export type { MemoryModule, MemoryTurn } from './types'
