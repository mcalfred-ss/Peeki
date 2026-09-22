import type { AgentDecision, CoachMode } from '../shared'
import type { MemoryTurn } from '../memory/types'

export const SYSTEM_PROMPT = `You are Peeki, a Windows PC AI assistant with live screen vision, short-term memory, and on-screen coaching.

Mission:
Help the user finish what they are doing on Windows by reading the screenshot and giving exact, actionable guidance. When helpful, point at UI with highlight boxes.

How to think:
1. Identify the active app/window and what is visible.
2. Infer the user's goal from their question + screenshot + recent conversation.
3. Give the best next action(s), with highlight marks when a specific control should be clicked or noticed.
4. Speak like a calm expert coach.

Memory rules:
- Recent prior turns may be provided as text (no old screenshots).
- Use them for follow-ups. Prefer CURRENT screenshot as ground truth if UI changed.

Highlight rules (critical):
- highlights use NORMALIZED coordinates 0..1 relative to the screenshot: x, y, width, height.
- (x,y) is the top-left of the box. Keep boxes tight around the control (usually 0.04–0.25 wide).
- Add a short label (2–5 words), e.g. "Click Export".
- In normal mode: usually 0–2 highlights for the immediate next control(s).
- In step mode: provide 2–5 steps[] and optional highlights with stepIndex starting at 0.
- Never invent controls that are not visible. If unsure where to point, omit highlights.
- Ignore Peeki's own UI if somehow visible.

Guidance style:
- Name visible UI labels exactly.
- Prefer numbered steps when needed.
- Keep practical for Windows.

JSON only with keys:
screenSummary, userGoal, guidance, nextStep, steps, highlights, proposedActions, needsConfirmation, confidence.`

export function formatMemoryBlock(recentTurns: MemoryTurn[]): string {
  if (recentTurns.length === 0) {
    return 'Session memory: (empty — this is the first turn or memory was cleared).'
  }

  const lines = recentTurns.map((turn, index) => {
    const parts = [
      `Turn ${index + 1}:`,
      `  User: ${turn.instruction}`,
      `  Seen then: ${turn.screenSummary}`,
      `  Goal: ${turn.userGoal}`,
      `  You said: ${turn.guidance}`
    ]
    if (turn.nextStep) {
      parts.push(`  Next step then: ${turn.nextStep}`)
    }
    return parts.join('\n')
  })

  return ['Session memory (oldest → newest):', ...lines].join('\n')
}

export function buildUserPrompt(
  instruction: string,
  allowProposedActions: boolean,
  recentTurns: MemoryTurn[] = [],
  mode: CoachMode = 'normal'
): string {
  const modeBlock =
    mode === 'step'
      ? [
          'Coach mode: STEP',
          '- Fill steps with 2–5 short ordered actions the user should take.',
          '- guidance should introduce the plan briefly; steps carry the detail.',
          '- nextStep should match steps[0].',
          '- Attach highlights with stepIndex for each step you can visually locate (0-based).'
        ].join('\n')
      : [
          'Coach mode: NORMAL',
          '- steps may be [] or a short list if useful.',
          '- Prefer 0–2 highlights for the immediate next control.',
          '- nextStep = the single best immediate action.'
        ].join('\n')

  return [
    formatMemoryBlock(recentTurns),
    '',
    `Current user request: ${instruction}`,
    '',
    modeBlock,
    '',
    'OS context: Windows desktop screenshot (primary display) — current ground truth.',
    '',
    allowProposedActions
      ? 'Action proposals are ENABLED. You may fill proposedActions when helpful. Each action needs: id, type (click|type|scroll|hotkey|open_app|wait), description, risk (low|medium|high), optional target/value, and for click/scroll also normalized x,y (0..1 point on the control).'
      : 'Action proposals are DISABLED. Return proposedActions as [] and needsConfirmation as false.',
    '',
    'Return JSON only with keys: screenSummary, userGoal, guidance, nextStep, steps, highlights, proposedActions, needsConfirmation, confidence.',
    'Each highlight: { id, x, y, width, height, label?, stepIndex? } with x/y/width/height in 0..1.'
  ].join('\n')
}

export function emptyDecision(errorHint: string): AgentDecision {
  return {
    screenSummary: 'Unable to analyze the screen.',
    userGoal: 'Unknown',
    guidance: errorHint,
    steps: [],
    highlights: [],
    proposedActions: [],
    needsConfirmation: false,
    confidence: 0
  }
}

export function formatAiError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'AI request failed. Please try again.'
  }

  const err = error as {
    status?: number
    code?: string
    message?: string
    error?: { message?: string; code?: string; type?: string }
  }

  const status = err.status
  const code = err.code || err.error?.code || ''
  const message = (err.error?.message || err.message || '').toLowerCase()

  if (status === 401 || code === 'invalid_api_key' || message.includes('incorrect api key')) {
    return 'Your OpenAI API key looks invalid. Check OPENAI_API_KEY in .env and restart Peeki.'
  }
  if (status === 429 || code === 'rate_limit_exceeded') {
    return 'OpenAI rate limit hit. Wait a few seconds and try again.'
  }
  if (
    status === 402 ||
    code === 'insufficient_quota' ||
    message.includes('quota') ||
    message.includes('billing')
  ) {
    return 'OpenAI says the account has no remaining quota. Check billing/credits, then try again.'
  }
  if (status === 404 || message.includes('model')) {
    return 'The configured vision model was not found. Set OPENAI_MODEL to a vision-capable model (e.g. gpt-4.1-mini) and restart.'
  }
  if (status === 400 && message.includes('image')) {
    return 'The screenshot could not be processed. Try again, or lower max capture size in settings.'
  }

  if (typeof err.message === 'string' && err.message.trim()) {
    return `AI request failed: ${err.message.trim()}`
  }

  return 'AI request failed. Please try again.'
}
