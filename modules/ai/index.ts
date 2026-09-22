import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import type {
  AgentDecision,
  ProposedAction,
  ActionRisk,
  ActionType,
  ScreenHighlight
} from '../shared'
import { SYSTEM_PROMPT, buildUserPrompt, emptyDecision, formatAiError } from './prompts'
import { cropAroundHighlight, mapCropPointToFull } from '../capture/crop'
import type {
  AiModule,
  LocalizeInCropInput,
  LocalizeInCropResult,
  RefineHighlightInput,
  VisionAnalyzeInput
} from './types'

const ACTION_TYPES: ActionType[] = ['click', 'type', 'scroll', 'hotkey', 'open_app', 'wait']
const RISKS: ActionRisk[] = ['low', 'medium', 'high']

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export function isUsableApiKey(apiKey: string): boolean {
  const key = apiKey.trim()
  if (!key.startsWith('sk-')) return false
  if (key.length < 20) return false
  if (/your-key|changeme|example|placeholder/i.test(key)) return false
  return true
}

function normalizeAction(raw: unknown, index: number): ProposedAction | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const type = asString(obj.type) as ActionType
  const risk = asString(obj.risk, 'medium') as ActionRisk
  if (!ACTION_TYPES.includes(type)) return null

  return {
    id: asString(obj.id) || randomUUID(),
    type,
    description: asString(obj.description, `Action ${index + 1}`),
    target: asString(obj.target) || undefined,
    value: asString(obj.value) || undefined,
    risk: RISKS.includes(risk) ? risk : 'medium',
    x:
      typeof obj.x === 'number' && Number.isFinite(obj.x)
        ? Math.min(1, Math.max(0, obj.x))
        : undefined,
    y:
      typeof obj.y === 'number' && Number.isFinite(obj.y)
        ? Math.min(1, Math.max(0, obj.y))
        : undefined
  }
}

function normalizeHighlight(
  raw: unknown,
  imageWidth: number,
  imageHeight: number
): ScreenHighlight | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  const toNorm = (value: unknown, axis: 'x' | 'y'): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    // Allow pixel coordinates when model returns them (> 1)
    if (value > 1) {
      const den = axis === 'x' ? imageWidth : imageHeight
      return den > 0 ? clamp01(value / den) : null
    }
    return clamp01(value)
  }

  let x = toNorm(obj.x, 'x')
  let y = toNorm(obj.y, 'y')
  let width = toNorm(obj.width, 'x')
  let height = toNorm(obj.height, 'y')
  const cx = toNorm(obj.cx, 'x')
  const cy = toNorm(obj.cy, 'y')

  // Prefer center point when the box is missing or absurdly large
  const boxTooBig =
    width !== null && height !== null && (width > 0.32 || height > 0.28 || width * height > 0.12)

  if ((x === null || y === null || width === null || height === null || boxTooBig) && cx !== null && cy !== null) {
    const tw = Math.min(0.05, width && width > 0.01 && width < 0.2 ? width : 0.04)
    const th = Math.min(0.06, height && height > 0.01 && height < 0.2 ? height : 0.045)
    x = clamp01(cx - tw / 2)
    y = clamp01(cy - th / 2)
    width = Math.min(tw, 1 - x)
    height = Math.min(th, 1 - y)
  }

  if (x === null || y === null || width === null || height === null) return null
  if (width <= 0.008 || height <= 0.008) return null
  if (x + width > 1.05 || y + height > 1.05) return null

  // Cap oversized boxes; keep them centered on the original box center
  if (width > 0.28 || height > 0.22) {
    const centerX = x + width / 2
    const centerY = y + height / 2
    width = Math.min(width, 0.22)
    height = Math.min(height, 0.16)
    x = clamp01(centerX - width / 2)
    y = clamp01(centerY - height / 2)
    width = Math.min(width, 1 - x)
    height = Math.min(height, 1 - y)
  }

  const stepRaw = obj.stepIndex
  const stepIndex =
    typeof stepRaw === 'number' && Number.isFinite(stepRaw)
      ? Math.max(0, Math.floor(stepRaw))
      : undefined

  return {
    id: asString(obj.id) || randomUUID(),
    x,
    y,
    width,
    height,
    label: asString(obj.label) || undefined,
    stepIndex
  }
}

function normalizeSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => asString(item).trim())
    .filter((s) => s.length > 0)
    .slice(0, 8)
}

function normalizeDecision(
  raw: unknown,
  allowProposedActions: boolean,
  imageWidth: number,
  imageHeight: number
): AgentDecision {
  if (!raw || typeof raw !== 'object') {
    return emptyDecision('The AI returned an unexpected response format. Please try again.')
  }

  const obj = raw as Record<string, unknown>
  const proposedRaw = Array.isArray(obj.proposedActions) ? obj.proposedActions : []
  const proposedActions = allowProposedActions
    ? proposedRaw
        .map((item, index) => normalizeAction(item, index))
        .filter((a): a is ProposedAction => a !== null)
    : []

  const highlightsRaw = Array.isArray(obj.highlights) ? obj.highlights : []
  const highlights = highlightsRaw
    .map((item) => normalizeHighlight(item, imageWidth, imageHeight))
    .filter((h): h is ScreenHighlight => h !== null)
    .slice(0, 6)

  const guidance = asString(obj.guidance).trim()
  if (!guidance) {
    return emptyDecision('The AI returned empty guidance. Please try again.')
  }

  return {
    screenSummary: asString(obj.screenSummary, 'No summary provided.').trim(),
    userGoal: asString(obj.userGoal, 'Not clearly stated.').trim(),
    guidance,
    nextStep: asString(obj.nextStep).trim() || undefined,
    steps: normalizeSteps(obj.steps),
    highlights,
    proposedActions,
    needsConfirmation: proposedActions.length > 0,
    confidence: Math.min(1, Math.max(0, asNumber(obj.confidence, 0.5)))
  }
}

export function createAiClient(options?: {
  apiKey?: string
  defaultModel?: string
}): AiModule {
  const apiKey = (options?.apiKey ?? process.env.OPENAI_API_KEY ?? '').trim()
  const defaultModel = (
    options?.defaultModel ??
    process.env.OPENAI_MODEL ??
    'gpt-4.1-mini'
  ).trim()

  const client = isUsableApiKey(apiKey) ? new OpenAI({ apiKey }) : null

  function isConfigured(): boolean {
    return Boolean(client)
  }

  async function analyzeScreen(input: VisionAnalyzeInput): Promise<AgentDecision> {
    if (!client) {
      return emptyDecision(
        'OpenAI API key is not configured. Put a real key in .env as OPENAI_API_KEY=sk-... then restart Peeki.'
      )
    }

    const model = (input.model || defaultModel).trim()
    const mode = input.mode ?? 'normal'

    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0.1,
        max_tokens: 1100,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: buildUserPrompt(
                  input.instruction,
                  input.allowProposedActions,
                  input.recentTurns ?? [],
                  mode,
                  { width: input.capture.width, height: input.capture.height },
                  input.elementMapText,
                  input.resolvedTargetLabel
                )
              },
              {
                type: 'image_url',
                image_url: {
                  url: input.capture.dataUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ]
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        return emptyDecision('The AI returned an empty response. Please try again.')
      }

      try {
        const parsed: unknown = JSON.parse(content)
        return normalizeDecision(
          parsed,
          input.allowProposedActions,
          input.capture.width,
          input.capture.height
        )
      } catch {
        return emptyDecision('Failed to parse the AI response. Please try again.')
      }
    } catch (error) {
      return emptyDecision(formatAiError(error))
    }
  }

  async function refineHighlight(input: RefineHighlightInput): Promise<ScreenHighlight> {
    if (!client) return input.highlight

    const crop = cropAroundHighlight(input.capture, input.highlight)
    if (!crop) return input.highlight

    const model = (input.model || defaultModel).trim()
    const hint = input.labelHint || input.highlight.label || 'the target control'

    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 120,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You pinpoint UI on a cropped screenshot. Return JSON only: { "cx": 0..1, "cy": 0..1, "found": true|false }. cx,cy are the CENTER of the requested control in THIS crop. If not visible, found=false.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Find the exact center of: ${hint}\nCrop size: ${crop.width}×${crop.height}px.\nReturn cx,cy in 0..1 relative to this crop only.`
              },
              {
                type: 'image_url',
                image_url: { url: crop.dataUrl, detail: 'high' }
              }
            ]
          }
        ]
      })

      const content = response.choices[0]?.message?.content
      if (!content) return input.highlight
      const parsed = JSON.parse(content) as { cx?: number; cy?: number; found?: boolean }
      if (parsed.found === false) return input.highlight
      if (typeof parsed.cx !== 'number' || typeof parsed.cy !== 'number') return input.highlight

      const refined = mapCropPointToFull(parsed.cx, parsed.cy, crop)
      return {
        ...refined,
        id: input.highlight.id,
        label: input.highlight.label,
        stepIndex: input.highlight.stepIndex
      }
    } catch {
      return input.highlight
    }
  }

  async function localizeInCrop(
    input: LocalizeInCropInput
  ): Promise<LocalizeInCropResult | null> {
    if (!client) return null
    const model = (input.model || defaultModel).trim()
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 120,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You locate UI inside a cropped screenshot region. Return JSON only: { "cx": 0..1, "cy": 0..1, "found": true|false }. cx,cy are the CENTER of the requested control in THIS crop. If not visible, found=false. Do not guess wildly.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Locate the center of: ${input.labelHint}\nCrop size: ${input.width}×${input.height}px.\nReturn cx,cy in 0..1 relative to this crop only.`
              },
              {
                type: 'image_url',
                image_url: { url: input.dataUrl, detail: 'high' }
              }
            ]
          }
        ]
      })
      const content = response.choices[0]?.message?.content
      if (!content) return null
      const parsed = JSON.parse(content) as { cx?: number; cy?: number; found?: boolean }
      if (parsed.found === false) return { cx: 0.5, cy: 0.5, found: false }
      if (typeof parsed.cx !== 'number' || typeof parsed.cy !== 'number') return null
      return {
        cx: Math.min(1, Math.max(0, parsed.cx)),
        cy: Math.min(1, Math.max(0, parsed.cy)),
        found: true
      }
    } catch {
      return null
    }
  }

  return {
    analyzeScreen,
    refineHighlight,
    localizeInCrop,
    isConfigured
  }
}

export type { AiModule, VisionAnalyzeInput, RefineHighlightInput } from './types'
export { SYSTEM_PROMPT, buildUserPrompt, formatAiError } from './prompts'
