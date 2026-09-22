import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { HistoryEntry, CoachMode } from '../shared'

export type AddHistoryInput = {
  instruction: string
  guidance: string
  nextStep?: string
  screenSummary?: string
  mode: CoachMode
  stepCount?: number
}

export type HistoryModule = {
  add(input: AddHistoryInput): HistoryEntry
  list(limit?: number): HistoryEntry[]
  clear(): void
  size(): number
}

type HistoryFile = {
  version: 1
  entries: HistoryEntry[]
}

const MAX_ENTRIES = 80

function emptyFile(): HistoryFile {
  return { version: 1, entries: [] }
}

function isEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Partial<HistoryEntry>
  return (
    typeof e.id === 'string' &&
    typeof e.instruction === 'string' &&
    typeof e.guidance === 'string' &&
    typeof e.createdAt === 'string'
  )
}

function readStore(filePath: string): HistoryFile {
  try {
    if (!existsSync(filePath)) return emptyFile()
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<HistoryFile>
    if (!raw || !Array.isArray(raw.entries)) return emptyFile()
    return { version: 1, entries: raw.entries.filter(isEntry) }
  } catch {
    return emptyFile()
  }
}

function writeStore(filePath: string, data: HistoryFile): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

export function createHistoryStore(filePath: string): HistoryModule {
  function add(input: AddHistoryInput): HistoryEntry {
    const entry: HistoryEntry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      instruction: input.instruction.trim().slice(0, 2000),
      guidance: input.guidance.trim().slice(0, 4000),
      nextStep: input.nextStep?.trim().slice(0, 500) || undefined,
      screenSummary: input.screenSummary?.trim().slice(0, 500) || undefined,
      mode: input.mode === 'step' ? 'step' : 'normal',
      stepCount: Math.max(0, input.stepCount ?? 0)
    }

    const store = readStore(filePath)
    store.entries.unshift(entry)
    while (store.entries.length > MAX_ENTRIES) {
      store.entries.pop()
    }
    writeStore(filePath, store)
    return { ...entry }
  }

  function list(limit = 30): HistoryEntry[] {
    const n = Math.max(0, limit)
    return readStore(filePath)
      .entries.slice(0, n)
      .map((e) => ({ ...e }))
  }

  function clear(): void {
    writeStore(filePath, emptyFile())
  }

  function size(): number {
    return readStore(filePath).entries.length
  }

  return { add, list, clear, size }
}

export type { HistoryEntry } from '../shared'
