/**
 * When the user says "done" / "next", re-look at the screen to verify progress
 * before advancing the coach plan.
 */
import type { AgentDecision, ScreenCapture } from '../shared'
import type { ScreenElementMap } from '../shared/screenIntel'
import type { AiModule } from '../ai'
import { burnCoordinateGrid } from '../capture/gridOverlay'
import {
  advanceCoachTrack,
  getCoachTrack,
  noteCoachScreen,
  setCoachTrack
} from './coachTrack'
import { buildProgressDecision } from './localAnswer'
import { filterCoachingHighlights, inferForegroundAppName } from './coachFilter'
import { formatMapForPrompt } from './resolve'
import { marksFromMatch } from './debugLog'
import { resolveTarget } from './resolve'

export async function verifyAndContinue(options: {
  instruction: string
  map: ScreenElementMap
  capture: ScreenCapture
  ai: AiModule
  model?: string
  allowProposedActions: boolean
}): Promise<AgentDecision> {
  const track = getCoachTrack()
  if (!track || track.steps.length === 0) {
    return buildProgressDecision(options.map, options.instruction, options.allowProposedActions)
      .decision
  }

  if (track.stepIndex >= track.steps.length) {
    return buildProgressDecision(options.map, options.instruction, options.allowProposedActions)
      .decision
  }

  const claimedDone = track.steps[track.stepIndex]
  const foreground = inferForegroundAppName(options.map)
  const mapText = [
    foreground ? `ACTIVE WORK WINDOW: ${foreground}` : 'ACTIVE WORK WINDOW: (unknown)',
    formatMapForPrompt(options.map, 40)
  ].join('\n')

  if (!options.ai.isConfigured()) {
    return buildProgressDecision(options.map, options.instruction, options.allowProposedActions)
      .decision
  }

  console.log(
    [
      'PROGRESS VERIFY',
      `goal: ${track.goal}`,
      `claimed done: ${claimedDone}`,
      `foreground: ${foreground || '(none)'}`,
      `prior screen: ${track.lastScreenSummary || '(none)'}`
    ].join('\n')
  )

  const decision = await options.ai.analyzeScreen({
    instruction: [
      'The user says they finished the previous tip and want to continue.',
      `Overall goal: ${track.goal}`,
      `Tip they claim is DONE: ${claimedDone}`,
      track.lastScreenSummary
        ? `What the screen looked like when that tip was given: ${track.lastScreenSummary}`
        : '',
      '',
      'Look at the CURRENT screenshot.',
      '1) Did they likely complete that tip? (yes/no in screenSummary start with DONE: yes|no)',
      '2) If YES: give the NEXT concrete tip for this goal (steps[0] = next action only; also fill nextStep).',
      '3) If NO: briefly say what is still missing and restate the same tip; highlight the control if useful.',
      '4) If they switched apps/screens away from the work, say so and tell them how to get back.',
      'Do NOT highlight app window titles or desktop icons unless they need to reopen the app.',
      'proposedActions=[].'
    ]
      .filter(Boolean)
      .join('\n'),
    capture: burnCoordinateGrid(options.capture),
    model: options.model || 'gpt-4.1-mini',
    allowProposedActions: false,
    recentTurns: [],
    mode: 'step',
    elementMapText: mapText
  })

  decision.highlights = filterCoachingHighlights(options.instruction, decision.highlights, options.map)

  const summary = (decision.screenSummary || '').toLowerCase()
  const doneYes = /\bdone:\s*yes\b/.test(summary) || /\byes[,.]?\s*(they|user|it)\b/.test(summary)
  const doneNo = /\bdone:\s*no\b/.test(summary)

  if (doneYes || (!doneNo && /next|continue|good|completed|finished/.test(summary))) {
    advanceCoachTrack()
    const after = getCoachTrack()
    if (after && after.stepIndex < after.steps.length) {
      // Prefer model nextStep; fall back to plan
      const next = decision.nextStep || after.steps[after.stepIndex]
      if (decision.steps.length === 0 && next) {
        decision.steps = [next, ...after.steps.slice(after.stepIndex + 1)].slice(0, 4)
      }
      setCoachTrack({
        goal: after.goal,
        steps: decision.steps.length > 0 ? decision.steps : after.steps,
        stepIndex: 0,
        lastTargetName: after.lastTargetName,
        lastScreenSummary: decision.screenSummary
      })
      decision.guidance = [
        `I checked your screen — that step looks done.`,
        foreground ? `You’re in ${foreground}.` : '',
        '',
        decision.guidance
      ]
        .filter(Boolean)
        .join('\n')
      decision.usedLocalAnswer = false
      decision.confidence = Math.max(decision.confidence, 0.75)

      const tip = decision.nextStep || decision.steps[0]
      if (tip) {
        const match = resolveTarget(options.map, tip)
        if (match && match.source !== 'vision') {
          decision.absoluteMarks = marksFromMatch(match)
          decision.targetSource = match.source as AgentDecision['targetSource']
          decision.highlights = []
        }
      }
      return decision
    }

    decision.guidance = [
      `I checked your screen — nice work, that goal looks finished.`,
      foreground ? `Current app: ${foreground}.` : '',
      decision.guidance
    ]
      .filter(Boolean)
      .join('\n')
    return decision
  }

  // Not done yet — keep same step, refresh screen note
  noteCoachScreen(decision.screenSummary || claimedDone)
  decision.guidance = [
    `I looked again — that step doesn’t look finished yet.`,
    foreground ? `I see you in: ${foreground}.` : '',
    '',
    decision.guidance || `Still need to: ${claimedDone}`
  ]
    .filter(Boolean)
    .join('\n')
  decision.nextStep = claimedDone
  decision.steps = [claimedDone, ...track.steps.slice(track.stepIndex + 1)].slice(0, 4)
  decision.usedLocalAnswer = false
  return decision
}
