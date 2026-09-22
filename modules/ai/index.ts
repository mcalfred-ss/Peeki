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
import type { AiModule, VisionAnalyzeInput } from './types'

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

function normalizeHighlight(raw: unknown): ScreenHighlight | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const x = clamp01(asNumber(obj.x, -1))
  const y = clamp01(asNumber(obj.y, -1))
  const width = clamp01(asNumber(obj.width, -1))
  const height = clamp01(asNumber(obj.height, -1))
  if (x < 0 || y < 0 || width <= 0.01 || height <= 0.01) return null
  if (x + width > 1.05 || y + height > 1.05) return null

  const stepRaw = obj.stepIndex
  const stepIndex =
    typeof stepRaw === 'number' && Number.isFinite(stepRaw)
      ? Math.max(0, Math.floor(stepRaw))
      : undefined

  return {
    id: asString(obj.id) || randomUUID(),
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
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

function normalizeDecision(raw: unknown, allowProposedActions: boolean): AgentDecision {
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
    .map((item) => normalizeHighlight(item))
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
        temperature: 0.2,
        max_tokens: 900,
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
                  mode
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
        return normalizeDecision(parsed, input.allowProposedActions)
      } catch {
        return emptyDecision('Failed to parse the AI response. Please try again.')
      }
    } catch (error) {
      return emptyDecision(formatAiError(error))
    }
  }

  return {
    analyzeScreen,
    isConfigured
  }
}

export type { AiModule, VisionAnalyzeInput } from './types'
export { SYSTEM_PROMPT, buildUserPrompt, formatAiError } from './prompts'
