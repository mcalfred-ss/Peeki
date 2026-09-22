/**
 * Decide how Peeki should handle a request — mode, local vs AI, soft suggestions.
 * No app-specific hardcoding; works from natural language only.
 */
import type { CoachMode, ModeSuggestion } from '../shared'
import {
  isInventoryRequest,
  isPointingRequest,
  isProgressRequest,
  isCoachingRequest,
  inferUserTargetIntent,
  type UserTargetIntent
} from './intent'
import { getCoachTrack } from './coachTrack'

export type SessionPlan = {
  intent: UserTargetIntent
  effectiveMode: 'normal' | 'step'
  preferLocal: boolean
  pointing: boolean
  inventory: boolean
  progress: boolean
  suggestion: ModeSuggestion | null
  reason: string
}

export function inferRecommendedMode(instruction: string): 'normal' | 'step' {
  const t = instruction.trim().toLowerCase()
  if (!t) return 'normal'

  if (isProgressRequest(instruction)) {
    return getCoachTrack()?.steps.length ? 'step' : 'normal'
  }

  if (isCoachingRequest(instruction)) return 'step'

  if (isInventoryRequest(instruction) || isPointingRequest(instruction)) {
    return 'normal'
  }

  if (
    /\b(step[- ]?by[- ]?step|walk me through|guide me|teach me|how do i|how can i|how to)\b/.test(
      t
    ) ||
    /\b(help me (set|get|fix|install|configure|create|make|change))\b/.test(t) ||
    /\b(then what|next steps?|one by one)\b/.test(t)
  ) {
    return 'step'
  }

  if (/\b(and then|after that|first|finally)\b/.test(t) && t.length > 40) {
    return 'step'
  }

  return 'normal'
}

export function wantsComputerAction(instruction: string): boolean {
  return /\b(click|open|launch|start|type|press|scroll|close|minimize|drag|double[- ]?click)\b/i.test(
    instruction
  )
}

export function planSession(input: {
  instruction: string
  settingsMode: CoachMode
  allowProposedActions: boolean
}): SessionPlan {
  const instruction = input.instruction.trim()
  const intent = inferUserTargetIntent(instruction)
  const inventory = isInventoryRequest(instruction) || intent === 'inventory'
  const progress = isProgressRequest(instruction) || intent === 'progress'
  const coaching = isCoachingRequest(instruction) || intent === 'coaching'
  const pointing = isPointingRequest(instruction) && !progress && !coaching
  const recommended = inferRecommendedMode(instruction)
  const preferLocal = inventory || pointing || progress

  let effectiveMode: 'normal' | 'step'
  if (progress || coaching) {
    effectiveMode = 'step'
  } else if (input.settingsMode === 'auto') {
    effectiveMode = recommended
  } else if (input.settingsMode === 'step') {
    effectiveMode = 'step'
  } else {
    effectiveMode = 'normal'
  }

  if (inventory || (pointing && recommended === 'normal')) {
    effectiveMode = 'normal'
  }

  const reasonParts: string[] = [`intent=${intent}`, `effective=${effectiveMode}`]
  let suggestion: ModeSuggestion | null = null

  if (progress) {
    reasonParts.push('progress-continue')
    return {
      intent: 'progress',
      effectiveMode,
      preferLocal: true,
      pointing: false,
      inventory: false,
      progress: true,
      suggestion: null,
      reason: reasonParts.join(' ')
    }
  }

  if (input.settingsMode === 'normal' && recommended === 'step') {
    suggestion = {
      recommended: 'step',
      reason: 'This looks like a multi-step task. Switch to Step mode for a guided walkthrough?',
      askUser: true
    }
    reasonParts.push('suggest-step')
  }

  if (input.settingsMode === 'auto' && effectiveMode === 'step') {
    suggestion = {
      recommended: 'step',
      reason: 'Used Step mode for this ask. Pin Step mode for future questions?',
      askUser: true
    }
    reasonParts.push('offer-pin-step')
  }

  if (wantsComputerAction(instruction) && !input.allowProposedActions) {
    suggestion = {
      recommended: (suggestion?.recommended ?? effectiveMode) as 'normal' | 'step',
      reason: suggestion
        ? `${suggestion.reason} Also turn on Act if you want Peeki to click for you.`
        : 'Turn on Act mode if you want Peeki to click or type for you (always confirms first).',
      askUser: true,
      suggestAct: true
    }
    reasonParts.push('suggest-act')
  }

  if (input.settingsMode === 'step' && pointing && !inventory) {
    suggestion = {
      recommended: 'normal',
      reason: 'Simple find requests are faster in Normal (or Auto). Switch?',
      askUser: true
    }
    reasonParts.push('suggest-normal')
  }

  if (
    recommended === 'step' ||
    /\b(how do i|how to|help me|walk me|teach me)\b/i.test(instruction)
  ) {
    if (!suggestion) {
      suggestion = {
        recommended: effectiveMode,
        reason: 'Want me on duty? I’ll keep watching your screen and live-coach as you work.',
        askUser: true,
        suggestOnDuty: true
      }
    } else {
      suggestion = {
        ...suggestion,
        reason: `${suggestion.reason} You can also put me On duty to live-coach as you go.`,
        suggestOnDuty: true
      }
    }
    reasonParts.push('suggest-on-duty')
  }

  return {
    intent,
    effectiveMode,
    preferLocal,
    pointing,
    inventory,
    progress,
    suggestion,
    reason: reasonParts.join(' ')
  }
}
