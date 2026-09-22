import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { SavedSkill, SaveSkillRequest, ScreenHighlight } from '../shared'

export type SkillsModule = {
  list(): SavedSkill[]
  get(id: string): SavedSkill | null
  save(input: SaveSkillRequest): SavedSkill
  remove(id: string): boolean
}

type SkillsFile = {
  version: 1
  skills: SavedSkill[]
}

const MAX_SKILLS = 40

function emptyFile(): SkillsFile {
  return { version: 1, skills: [] }
}

function isSkill(value: unknown): value is SavedSkill {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<SavedSkill>
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.instruction === 'string' &&
    Array.isArray(s.steps)
  )
}

function readStore(filePath: string): SkillsFile {
  try {
    if (!existsSync(filePath)) return emptyFile()
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<SkillsFile>
    if (!raw || !Array.isArray(raw.skills)) return emptyFile()
    return {
      version: 1,
      skills: raw.skills.filter(isSkill).map((s) => ({
        ...s,
        highlights: Array.isArray(s.highlights) ? (s.highlights as ScreenHighlight[]) : [],
        steps: s.steps.map(String)
      }))
    }
  } catch {
    return emptyFile()
  }
}

function writeStore(filePath: string, data: SkillsFile): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

export function createSkillsStore(filePath: string): SkillsModule {
  function list(): SavedSkill[] {
    return readStore(filePath)
      .skills.slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => ({ ...s, highlights: [...s.highlights], steps: [...s.steps] }))
  }

  function get(id: string): SavedSkill | null {
    const found = readStore(filePath).skills.find((s) => s.id === id)
    return found
      ? { ...found, highlights: [...found.highlights], steps: [...found.steps] }
      : null
  }

  function save(input: SaveSkillRequest): SavedSkill {
    const name = input.name.trim().slice(0, 80) || 'Untitled skill'
    const now = new Date().toISOString()
    const skill: SavedSkill = {
      id: randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      instruction: input.instruction.trim().slice(0, 2000),
      guidance: input.guidance.trim().slice(0, 4000),
      steps: input.steps.map((s) => s.trim()).filter(Boolean).slice(0, 30),
      highlights: (input.highlights ?? []).slice(0, 40),
      screenSummary: input.screenSummary?.trim().slice(0, 500) || undefined
    }

    const store = readStore(filePath)
    store.skills.unshift(skill)
    while (store.skills.length > MAX_SKILLS) {
      store.skills.pop()
    }
    writeStore(filePath, store)
    return { ...skill, highlights: [...skill.highlights], steps: [...skill.steps] }
  }

  function remove(id: string): boolean {
    const store = readStore(filePath)
    const next = store.skills.filter((s) => s.id !== id)
    if (next.length === store.skills.length) return false
    writeStore(filePath, { version: 1, skills: next })
    return true
  }

  return { list, get, save, remove }
}

export type { SavedSkill, SaveSkillRequest } from '../shared'
