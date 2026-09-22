/**
 * Local answers from the live screen map — no OpenAI call.
 * Use whenever UIA/OCR already has enough evidence.
 */
import type { AgentDecision } from '../shared'
import type { AbsoluteMark, ScreenElementMap, TargetMatch } from '../shared/screenIntel'
import { getCoachTrack, advanceCoachTrack, type CoachTrack } from './coachTrack'
import { resolveTarget } from './resolve'
import { marksFromMatch } from './debugLog'

export type DesktopInventory = {
  desktop: string[]
  taskbar: string[]
}

export function collectDesktopInventory(map: ScreenElementMap): DesktopInventory {
  const desktopNames = new Set<string>()
  const taskbarNames = new Set<string>()

  for (const el of map.elements || []) {
    const name = (el.name || el.text || '').trim()
    if (!name) continue
    if (el.source === 'desktop' || el.role === 'DesktopIcon') desktopNames.add(name)
    if (el.source === 'taskbar' || el.role === 'TaskbarButton') taskbarNames.add(name)
  }

  for (const u of map.uiElements) {
    const name = (u.name || '').trim()
    if (!name) continue
    if (u.role === 'DesktopIcon') desktopNames.add(name)
    if (u.role === 'TaskbarButton') taskbarNames.add(name)
  }

  return {
    desktop: [...desktopNames].sort((a, b) => a.localeCompare(b)),
    taskbar: [...taskbarNames].sort((a, b) => a.localeCompare(b))
  }
}

export function buildInventoryDecision(
  instruction: string,
  map: ScreenElementMap
): AgentDecision {
  const inv = collectDesktopInventory(map)
  const desktopCount = inv.desktop.length
  const taskbarCount = inv.taskbar.length
  const wantsCount = /\b(how many|count|number of)\b/i.test(instruction)

  const desktopList =
    desktopCount === 0
      ? '(none detected on the desktop)'
      : inv.desktop.map((n, i) => `${i + 1}. ${n}`).join('\n')

  const taskbarBlock =
    taskbarCount > 0
      ? `\n\nTaskbar items (${taskbarCount}):\n${inv.taskbar.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
      : ''

  const guidance = wantsCount
    ? [
        `I can see ${desktopCount} desktop icon${desktopCount === 1 ? '' : 's'} from Windows UI Automation.`,
        desktopCount > 0 ? `\n${desktopList}` : '',
        taskbarCount > 0
          ? `\nAlso ${taskbarCount} taskbar item${taskbarCount === 1 ? '' : 's'}.${taskbarBlock}`
          : '',
        '\n\n(Answered from your live screen map — no AI credits used.)'
      ].join('')
    : [
        `Apps / shortcuts on your desktop (${desktopCount}):`,
        desktopList,
        taskbarBlock,
        '\n\n(Answered from your live screen map — no AI credits used.)'
      ].join('\n')

  return {
    screenSummary: `Desktop icons: ${desktopCount}; taskbar items: ${taskbarCount}.`,
    userGoal: wantsCount ? 'Count apps on screen' : 'List apps on screen',
    guidance: guidance.trim(),
    nextStep: wantsCount
      ? `${desktopCount} desktop icon${desktopCount === 1 ? '' : 's'} found.`
      : desktopCount > 0
        ? `First on the list: ${inv.desktop[0]}.`
        : 'No desktop icons detected.',
    steps: [],
    highlights: [],
    proposedActions: [],
    needsConfirmation: false,
    confidence: desktopCount > 0 ? 0.98 : 0.6
  }
}

export function buildLocateDecision(
  match: TargetMatch,
  absoluteMarks: AbsoluteMark[],
  allowProposedActions: boolean
): AgentDecision {
  const b = match.bounds
  const guidance = [
    `Here it is — “${match.label}”.`,
    `Found via ${match.source} (${match.targetType || 'element'}, confidence ${match.confidence.toFixed(2)}).`,
    `Position: x=${b.x}, y=${b.y}, ${b.width}×${b.height}.`,
    '(Located from Windows UI Automation — no AI credits used.)'
  ].join('\n')

  const decision: AgentDecision = {
    screenSummary: `Located “${match.label}” via ${match.source}.`,
    userGoal: `Find ${match.label}`,
    guidance,
    nextStep: `Here it is — “${match.label}”.`,
    steps: [],
    highlights: [],
    absoluteMarks,
    targetSource: match.source as AgentDecision['targetSource'],
    proposedActions: [],
    needsConfirmation: false,
    confidence: match.confidence
  }

  if (
    allowProposedActions &&
    match.source !== 'vision' &&
    match.confidence >= 0.5
  ) {
    const c = {
      x: Math.round(b.x + b.width / 2),
      y: Math.round(b.y + b.height / 2)
    }
    decision.proposedActions = [
      {
        id: 'resolved-click',
        type: 'click',
        description: `Click “${match.label}”`,
        risk: 'low',
        uiaName: match.label,
        physicalBounds: b,
        physicalX: c.x,
        physicalY: c.y,
        targetSource: match.source as 'uia' | 'ocr' | 'desktop' | 'taskbar'
      }
    ]
    decision.needsConfirmation = true
  }

  return decision
}

export function buildProgressDecision(
  map: ScreenElementMap,
  instruction: string,
  allowProposedActions: boolean
): { decision: AgentDecision; match: TargetMatch | null; absoluteMarks?: AbsoluteMark[] } {
  const before = getCoachTrack()
  if (!before || before.steps.length === 0) {
    return {
      decision: {
        screenSummary: 'No active coaching plan.',
        userGoal: 'Continue',
        guidance:
          'I don’t have an active step to continue from. Tell me what you want to do next (e.g. “find Photoshop” or “help me change wallpaper”).',
        nextStep: 'Ask a new goal.',
        steps: [],
        highlights: [],
        proposedActions: [],
        needsConfirmation: false,
        confidence: 0.7,
        usedLocalAnswer: true
      },
      match: null
    }
  }

  const advanced = advanceCoachTrack()
  const track = advanced || before

  if (track.stepIndex >= track.steps.length) {
    return {
      decision: {
        screenSummary: `Goal complete: ${track.goal}`,
        userGoal: track.goal,
        guidance: `Nice work — that looks done for “${track.goal}”. Want another task, or keep me On duty for live coaching?`,
        nextStep: 'Ask a new goal, or say what to do next.',
        steps: track.steps,
        highlights: [],
        proposedActions: [],
        needsConfirmation: false,
        confidence: 0.95,
        usedLocalAnswer: true,
        modeSuggestion: {
          recommended: 'normal',
          reason: 'Goal finished. Go On duty if you want me to keep watching.',
          askUser: true,
          suggestOnDuty: true
        }
      },
      match: null
    }
  }

  const stepText = track.steps[track.stepIndex]
  const match = resolveTarget(map, stepText) || (track.lastTargetName
    ? resolveTarget(map, `find ${track.lastTargetName}`)
    : null)

  let absoluteMarks: AbsoluteMark[] | undefined
  let decision: AgentDecision

  if (match && match.source !== 'vision') {
    const locate = buildLocateDecision(match, marksFromMatch(match), allowProposedActions)
    decision = {
      ...locate,
      screenSummary: `Continuing “${track.goal}” — step ${track.stepIndex + 1}/${track.steps.length}.`,
      userGoal: track.goal,
      guidance: [
        `Got it — you finished the previous step.`,
        ``,
        `Next (${track.stepIndex + 1}/${track.steps.length}): ${stepText}`,
        ``,
        `I’m pointing at “${match.label}” for this step.`,
        `(Local continue — no AI credits.)`
      ].join('\n'),
      nextStep: stepText,
      steps: track.steps,
      usedLocalAnswer: true,
      confidence: Math.max(locate.confidence, 0.9)
    }
    absoluteMarks = locate.absoluteMarks
  } else {
    decision = {
      screenSummary: `Continuing “${track.goal}” — step ${track.stepIndex + 1}/${track.steps.length}.`,
      userGoal: track.goal,
      guidance: [
        `Got it — continuing.`,
        ``,
        `Next (${track.stepIndex + 1}/${track.steps.length}): ${stepText}`,
        ``,
        `Say “done” again when this step is finished.`,
        `(Local continue — no AI credits.)`
      ].join('\n'),
      nextStep: stepText,
      steps: track.steps,
      highlights: [],
      proposedActions: [],
      needsConfirmation: false,
      confidence: 0.85,
      usedLocalAnswer: true
    }
  }

  void instruction
  return { decision, match, absoluteMarks }
}

export type { CoachTrack }
