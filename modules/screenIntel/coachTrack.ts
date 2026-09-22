/**
 * Session coach track — so "I did that" / "next" can continue the plan.
 */
export type CoachTrack = {
  goal: string
  steps: string[]
  stepIndex: number
  lastTargetName?: string
  /** What the screen looked like when the current tip was given */
  lastScreenSummary?: string
  updatedAt: string
}

let track: CoachTrack | null = null

export function getCoachTrack(): CoachTrack | null {
  return track ? { ...track, steps: [...track.steps] } : null
}

export function clearCoachTrack(): void {
  track = null
}

export function setCoachTrack(input: {
  goal: string
  steps?: string[]
  stepIndex?: number
  lastTargetName?: string
  lastScreenSummary?: string
}): CoachTrack {
  const steps =
    input.steps && input.steps.length > 0
      ? input.steps.map((s) => s.trim()).filter(Boolean)
      : defaultStepsForGoal(input.goal, input.lastTargetName)

  track = {
    goal: input.goal.trim(),
    steps,
    stepIndex: Math.max(0, input.stepIndex ?? 0),
    lastTargetName: input.lastTargetName,
    lastScreenSummary: input.lastScreenSummary,
    updatedAt: new Date().toISOString()
  }
  return getCoachTrack()!
}

/** Update observation about the current tip without advancing. */
export function noteCoachScreen(summary: string): void {
  if (!track) return
  track = {
    ...track,
    lastScreenSummary: summary.slice(0, 400),
    updatedAt: new Date().toISOString()
  }
}

export function advanceCoachTrack(): CoachTrack | null {
  if (!track) return null
  if (track.stepIndex < track.steps.length - 1) {
    track = {
      ...track,
      stepIndex: track.stepIndex + 1,
      updatedAt: new Date().toISOString()
    }
  } else {
    // Completed — keep last step but mark past end via index === length
    track = {
      ...track,
      stepIndex: track.steps.length,
      updatedAt: new Date().toISOString()
    }
  }
  return getCoachTrack()
}

function defaultStepsForGoal(goal: string, targetName?: string): string[] {
  const name = targetName || guessNameFromGoal(goal)
  if (name) {
    return [
      `Find “${name}” on your screen.`,
      `Open “${name}” (double-click the icon, or select it and press Enter).`,
      `Confirm “${name}” is open and ready — tell me when you’re there.`
    ]
  }
  return [
    'Do the action I just pointed out.',
    'Tell me when that step is done so I can continue.',
    'Finish the remaining part of your goal.'
  ]
}

function guessNameFromGoal(goal: string): string | undefined {
  const m = goal.match(/(?:find|open|show|locate|click)\s+(?:the\s+)?(.+)/i)
  if (m?.[1]) return m[1].replace(/[.?!]$/, '').trim()
  if (/^[a-z0-9][a-z0-9 .+\-]{1,40}$/i.test(goal.trim())) return goal.trim()
  return undefined
}
