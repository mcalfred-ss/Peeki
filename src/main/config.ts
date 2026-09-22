import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { DEFAULT_SETTINGS, type AppSettings, type CoachMode } from '@modules/shared'

/**
 * Load .env from project root (dev) without adding a dotenv dependency.
 */
export function loadEnvFile(rootDir: string): void {
  const envPath = resolve(rootDir, '.env')
  if (!existsSync(envPath)) return

  const forceKeys = new Set(['OPENAI_API_KEY', 'OPENAI_MODEL'])
  const text = readFileSync(envPath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    value = value.trim()
    if (forceKeys.has(key) || !(key in process.env) || !String(process.env[key] ?? '').trim()) {
      process.env[key] = value
    }
  }
}

function isOverlayPosition(value: unknown): value is AppSettings['overlayPosition'] {
  if (value === null) return true
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.x === 'number' && typeof obj.y === 'number'
}

function asCoachMode(value: unknown, fallback: CoachMode): CoachMode {
  return value === 'step' || value === 'normal' || value === 'auto' ? value : fallback
}

function mergeSettings(raw: unknown): AppSettings {
  const base = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Partial<AppSettings>

  return {
    ...base,
    ...obj,
    model: typeof obj.model === 'string' ? obj.model : base.model,
    maxCaptureWidth:
      typeof obj.maxCaptureWidth === 'number' ? obj.maxCaptureWidth : base.maxCaptureWidth,
    sendScreenByDefault:
      typeof obj.sendScreenByDefault === 'boolean'
        ? obj.sendScreenByDefault
        : base.sendScreenByDefault,
    allowProposedActions:
      typeof obj.allowProposedActions === 'boolean'
        ? obj.allowProposedActions
        : base.allowProposedActions,
    overlayVisible:
      typeof obj.overlayVisible === 'boolean' ? obj.overlayVisible : base.overlayVisible,
    overlayPosition: isOverlayPosition(obj.overlayPosition)
      ? obj.overlayPosition
      : base.overlayPosition,
    coachMode: asCoachMode(obj.coachMode, base.coachMode),
    privacyBlurEnabled:
      typeof obj.privacyBlurEnabled === 'boolean'
        ? obj.privacyBlurEnabled
        : base.privacyBlurEnabled,
    voiceReplyEnabled:
      typeof obj.voiceReplyEnabled === 'boolean'
        ? obj.voiceReplyEnabled
        : base.voiceReplyEnabled,
    watchEnabled:
      typeof obj.watchEnabled === 'boolean' ? obj.watchEnabled : base.watchEnabled,
    watchIntervalSec:
      typeof obj.watchIntervalSec === 'number' && obj.watchIntervalSec >= 8
        ? obj.watchIntervalSec
        : base.watchIntervalSec,
    computerControlEnabled:
      typeof obj.computerControlEnabled === 'boolean'
        ? obj.computerControlEnabled
        : base.computerControlEnabled,
    debugScreenIntel:
      typeof obj.debugScreenIntel === 'boolean'
        ? obj.debugScreenIntel
        : base.debugScreenIntel
  }
}

export function createSettingsStore(persistPath: string): {
  get: () => AppSettings
  update: (partial: Partial<AppSettings>) => AppSettings
} {
  let settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    model: process.env.OPENAI_MODEL || DEFAULT_SETTINGS.model
  }

  if (existsSync(persistPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(persistPath, 'utf8'))
      settings = mergeSettings(parsed)
      settings.model = process.env.OPENAI_MODEL || settings.model
    } catch {
      // Keep defaults if settings file is corrupt
    }
  }

  function persist(): void {
    const dir = dirname(persistPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(persistPath, JSON.stringify(settings, null, 2), 'utf8')
  }

  return {
    get: () => ({ ...settings }),
    update: (partial) => {
      settings = { ...settings, ...partial }
      persist()
      return { ...settings }
    }
  }
}
