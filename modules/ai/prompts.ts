import type { AgentDecision, CoachMode } from '../shared'
import type { MemoryTurn } from '../memory/types'

export const SYSTEM_PROMPT = `You are Peeki, a Windows PC AI assistant with live screen vision and on-screen coaching.

Mission:
Help the user finish what they are doing by reading the CURRENT screenshot.

How to think:
1. Identify the active app/window from pixels in the image.
2. Infer the goal from the question + screenshot + recent conversation.
3. If they asked to FIND/OPEN something: locate that control and return a tight highlight.
4. If they asked for HELP designing/editing/creating while ALREADY inside an app: coach the work on screen. Do NOT highlight the app icon, desktop shortcut, or window title bar.
5. For creative coaching, prefer practical steps about the canvas, layers, tools, or composition you can see.

Coordinate system (critical — follow exactly):
- The screenshot includes a light 10×10 cyan GRID.
- Origin (0,0) is the TOP-LEFT corner of the IMAGE (tick marks).
- x increases right; y increases down. Values are normalized 0..1.
- Use the grid: each cell is 0.1 wide/tall. Example: center of cell column 2, row 8 ≈ x=0.25, y=0.85.
- x,y = top-left of the highlight box; also set cx,cy = center of the control.
- Boxes must be TIGHT around the clickable control:
  - Toolbar / tool icon: width 0.02–0.045, height 0.03–0.055
  - Button: width 0.06–0.18, height 0.03–0.07
  - Layer row: width 0.12–0.22, height 0.03–0.05
  - Never highlight a whole sidebar, status bar strip, window title, or desktop icon unless the user asked to find that app.
- Measure from THIS image only. Do not guess from memory of typical layouts.
- If you cannot see a useful control clearly, omit highlights (highlights=[]) and still give strong guidance/steps.

Memory rules:
- Prior turns are text only. Prefer the CURRENT screenshot if the UI changed.
- Ignore Peeki's own UI if visible.

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
  mode: CoachMode = 'normal',
  imageSize?: { width: number; height: number },
  elementMapText?: string,
  resolvedTargetLabel?: string
): string {
  const modeBlock =
    mode === 'step'
      ? [
          'Coach mode: STEP',
          '- Fill steps with 2–5 short ordered actions.',
          '- guidance introduces the plan; steps carry the detail.',
          '- nextStep must match steps[0].',
          '- For each step you can see, add a highlight with matching stepIndex (0-based).',
          '- Each step highlight must target ONE control, tightly.'
        ].join('\n')
      : [
          'Coach mode: NORMAL',
          '- Prefer 1 highlight for the single best next control (0–2 max).',
          '- nextStep = that immediate action.',
          '- If the task clearly needs many steps, still return a short answer; Peeki may offer Step mode to the user.'
        ].join('\n')

  const sizeBlock = imageSize
    ? [
        `Screenshot pixels: ${imageSize.width}×${imageSize.height}.`,
        'A cyan 10×10 grid may be drawn on the image — use it only as a vision fallback.',
        'Prefer named UI Automation / OCR elements when listed below.'
      ].join('\n')
    : 'Prefer named UI elements when provided; vision coordinates are fallback only.'

  const mapBlock = elementMapText
    ? ['SCREEN ELEMENT MAP (ground truth from Windows):', elementMapText].join('\n')
    : 'SCREEN ELEMENT MAP: (unavailable this turn — vision only).'

  const resolvedBlock = resolvedTargetLabel
    ? [
        `TARGET ALREADY RESOLVED by Peeki screen intelligence: "${resolvedTargetLabel}".`,
        'Do NOT invent highlight coordinates. Return highlights as [].',
        'Explain where it is in guidance/nextStep using the element name.'
      ].join('\n')
    : [
        'If the user asks to find/point/show something, match it against the element map by name before guessing vision boxes.',
        'If the user asks for help designing/editing/creating and they are already inside an app: coach the canvas/tools/layers. highlights=[] unless a specific tool/layer helps. Never highlight the app window title or desktop icon.'
      ].join('\n')

  return [
    formatMemoryBlock(recentTurns),
    '',
    `Current user request: ${instruction}`,
    '',
    modeBlock,
    '',
    sizeBlock,
    '',
    mapBlock,
    '',
    resolvedBlock,
    '',
    'OS context: Windows primary display.',
    '',
    allowProposedActions
      ? 'Action proposals ENABLED. Prefer targeting named elements; for click include normalized x,y only as last resort.'
      : 'Action proposals DISABLED. Return proposedActions as [] and needsConfirmation as false.',
    '',
    'Return JSON only.',
    'Each highlight: { id, x, y, width, height, cx?, cy?, label?, stepIndex? } with 0..1 coords — vision fallback only.'
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
