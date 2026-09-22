/**
 * Short-term session memory — text turns only (never stores screenshots).
 */
export type MemoryTurn = {
  id: string
  createdAt: string
  instruction: string
  screenSummary: string
  userGoal: string
  guidance: string
  nextStep?: string
}

export interface MemoryModule {
  add(turn: Omit<MemoryTurn, 'id' | 'createdAt'> & Partial<Pick<MemoryTurn, 'id' | 'createdAt'>>): MemoryTurn
  getRecent(limit?: number): MemoryTurn[]
  clear(): void
  size(): number
}
