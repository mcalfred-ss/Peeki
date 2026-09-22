import './styles.css'
import type {
  AgentDecision,
  AskBarLayout,
  CoachMode,
  HistoryEntry,
  ModeSuggestion,
  ProposedAction,
  SavedSkill,
  ScreenHighlight
} from '../../../modules/shared'
import { TEACH_PRESETS } from '../../../modules/shared'

function requireEl<T extends HTMLElement>(id: string, guard: (el: HTMLElement) => el is T): T {
  const el = document.getElementById(id)
  if (!el || !guard(el)) {
    throw new Error(`Ask bar element missing: #${id}`)
  }
  return el
}

const form = requireEl('ask-form', (el): el is HTMLFormElement => el instanceof HTMLFormElement)
const input = requireEl(
  'ask-input',
  (el): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement
)
const sendBtn = requireEl('btn-send', (el): el is HTMLButtonElement => el instanceof HTMLButtonElement)
const plusBtn = requireEl('btn-plus', (el): el is HTMLButtonElement => el instanceof HTMLButtonElement)
const voiceBtn = requireEl('btn-voice', (el): el is HTMLButtonElement => el instanceof HTMLButtonElement)
const voiceLabel = requireEl('voice-label', (el): el is HTMLElement => el instanceof HTMLElement)
const backdrop = requireEl('backdrop', (el): el is HTMLElement => el instanceof HTMLElement)
const panel = requireEl('panel', (el): el is HTMLElement => el instanceof HTMLElement)
const panelBody = requireEl('panel-body', (el): el is HTMLElement => el instanceof HTMLElement)
const panelFooter = requireEl('panel-footer', (el): el is HTMLElement => el instanceof HTMLElement)
const coach = requireEl('coach', (el): el is HTMLElement => el instanceof HTMLElement)
const coachIndex = requireEl('coach-index', (el): el is HTMLElement => el instanceof HTMLElement)
const coachText = requireEl('coach-text', (el): el is HTMLElement => el instanceof HTMLElement)
const coachBack = requireEl(
  'btn-coach-back',
  (el): el is HTMLButtonElement => el instanceof HTMLButtonElement
)
const coachNext = requireEl(
  'btn-coach-next',
  (el): el is HTMLButtonElement => el instanceof HTMLButtonElement
)
const coachAsk = requireEl(
  'btn-coach-ask',
  (el): el is HTMLButtonElement => el instanceof HTMLButtonElement
)
const coachDone = requireEl(
  'btn-coach-done',
  (el): el is HTMLButtonElement => el instanceof HTMLButtonElement
)
const statusPill = requireEl('status-pill', (el): el is HTMLElement => el instanceof HTMLElement)

type SpeechRec = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

type PanelKind = 'none' | 'result' | 'menu' | 'skills' | 'history' | 'safety'

type LastAnswer = {
  instruction: string
  guidance: string
  steps: string[]
  highlights: ScreenHighlight[]
  screenSummary?: string
}

let busy = false
let hasApiKey = true
let memoryTurnCount = 0
let coachMode: CoachMode = 'auto'
let privacyOn = false
let actOn = false
let onDuty = false
let computerControlEnabled = true
let voiceReplyEnabled = true
let debugScreenIntel = false
let listening = false
let steps: string[] = []
let stepIndex = 0
let pendingActions: ProposedAction[] = []
let recognition: SpeechRec | null = null
let panelKind: PanelKind = 'none'
let lastAnswer: LastAnswer | null = null
let layout: AskBarLayout = 'ask'
let resultHideTimer: number | null = null

function syncSendEnabled(): void {
  // Allow asks without API key — inventory / UIA locate work locally
  sendBtn.disabled = busy || input.value.trim().length === 0
}

function syncVoiceLabel(): void {
  voiceLabel.textContent = listening ? 'Listening…' : 'Voice'
  voiceBtn.classList.toggle('active', listening)
}

function syncStatusPill(): void {
  const bits: string[] = []
  if (onDuty) bits.push('On duty')
  if (coachMode === 'auto') bits.push('Auto')
  else if (coachMode === 'step') bits.push('Step')
  else bits.push('Normal')
  if (actOn) bits.push('Act')
  if (bits.length === 0) {
    statusPill.hidden = true
    statusPill.textContent = ''
    return
  }
  statusPill.hidden = false
  statusPill.textContent = bits.join(' · ')
}

async function setOnDuty(enabled: boolean, announce = true): Promise<void> {
  onDuty = enabled
  try {
    await window.peeki.toggleWatch(enabled)
    await window.peeki.updateSettings({ watchEnabled: enabled })
  } catch {
    // keep local state
  }
  syncStatusPill()
  if (announce) {
    showResult(
      enabled
        ? 'On duty — I’ll watch your screen and live-coach as you work. Stay quiet when you’re fine.'
        : 'Off duty — I won’t watch until you wake me again.',
      'info'
    )
  }
}

function cycleCoachMode(): CoachMode {
  if (coachMode === 'auto') return 'normal'
  if (coachMode === 'normal') return 'step'
  return 'auto'
}

function coachModeLabel(mode: CoachMode): string {
  switch (mode) {
    case 'auto':
      return 'Auto'
    case 'normal':
      return 'Normal'
    case 'step':
      return 'Step'
    default: {
      const _exhaustive: never = mode
      return _exhaustive
    }
  }
}

function coachModeHint(mode: CoachMode): string {
  switch (mode) {
    case 'auto':
      return 'Picks Normal or Step from your question'
    case 'normal':
      return 'Quick single answer + highlight'
    case 'step':
      return 'Guided walkthrough, one step at a time'
    default: {
      const _exhaustive: never = mode
      return _exhaustive
    }
  }
}

function autofocus(): void {
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
}

function clearResultTimer(): void {
  if (resultHideTimer !== null) {
    window.clearTimeout(resultHideTimer)
    resultHideTimer = null
  }
}

async function enterAskLayout(): Promise<void> {
  layout = 'ask'
  document.body.classList.remove('is-coach')
  coach.hidden = true
  await window.peeki.setAskBarLayout('ask')
}

async function enterCoachLayout(): Promise<void> {
  layout = 'coach'
  hidePanel()
  document.body.classList.add('is-coach')
  coach.hidden = false
  await window.peeki.setAskBarLayout('coach')
}

function hidePanel(): void {
  panel.hidden = true
  panel.classList.remove('error', 'info', 'safety')
  panelBody.textContent = ''
  panelFooter.hidden = true
  panelFooter.className = 'panel-footer'
  panelFooter.replaceChildren()
  panelKind = 'none'
  plusBtn.classList.remove('active')
}

function openPanel(kind: PanelKind): void {
  panel.hidden = false
  panelKind = kind
  plusBtn.classList.toggle('active', kind === 'menu' || kind === 'skills' || kind === 'history')
}

function speak(text: string): void {
  if (!voiceReplyEnabled || typeof window.speechSynthesis === 'undefined') return
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text.slice(0, 400))
  utter.rate = 1.02
  window.speechSynthesis.speak(utter)
}

function chip(label: string, opts?: { primary?: boolean; disabled?: boolean }): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = opts?.primary ? 'chip primary-chip' : 'chip'
  btn.textContent = label
  if (opts?.disabled) btn.disabled = true
  return btn
}

function renderCoachDock(): void {
  if (steps.length === 0) {
    coach.hidden = true
    return
  }
  coachIndex.textContent = `${stepIndex + 1}/${steps.length}`
  coachText.textContent = steps[stepIndex] ?? ''
  coachText.title = steps[stepIndex] ?? ''
  coachBack.disabled = stepIndex <= 0 || busy
  coachNext.disabled = stepIndex >= steps.length - 1 || busy
  coach.hidden = false
}

async function startCoaching(): Promise<void> {
  clearResultTimer()
  renderCoachDock()
  await enterCoachLayout()
  void window.peeki.setHighlightStep(stepIndex)
}

async function endCoaching(hideBar = true): Promise<void> {
  steps = []
  stepIndex = 0
  coach.hidden = true
  document.body.classList.remove('is-coach')
  await window.peeki.hideHighlights()
  if (hideBar) {
    await window.peeki.hideAskBar()
  } else {
    await enterAskLayout()
    autofocus()
  }
}

function showResult(
  text: string,
  kind: 'ok' | 'error' | 'info' = 'ok',
  meta?: string,
  suggestion?: ModeSuggestion | null
): void {
  clearResultTimer()
  void enterAskLayout()
  hidePanel()
  openPanel('result')
  panel.classList.toggle('error', kind === 'error')
  panel.classList.toggle('info', kind === 'info')
  panelBody.textContent = text
  if (meta) {
    const metaEl = document.createElement('div')
    metaEl.className = 'panel-meta'
    metaEl.textContent = meta
    panelBody.appendChild(metaEl)
  }

  if (suggestion?.askUser) {
    const tip = document.createElement('div')
    tip.className = 'panel-meta mode-suggest'
    tip.textContent = suggestion.reason
    panelBody.appendChild(tip)
  }

  panelFooter.hidden = false
  panelFooter.replaceChildren()

  if (suggestion?.askUser) {
    if (suggestion.suggestOnDuty && !onDuty) {
      const dutyBtn = chip('Go on duty', { primary: !suggestion.suggestAct })
      dutyBtn.addEventListener('click', () => {
        void setOnDuty(true)
      })
      panelFooter.append(dutyBtn)
    }
    if (suggestion.recommended === 'step' || suggestion.recommended === 'normal') {
      const needsModeSwitch =
        (suggestion.recommended === 'step' && coachMode !== 'step') ||
        (suggestion.recommended === 'normal' && coachMode === 'step')
      if (needsModeSwitch && !suggestion.suggestOnDuty) {
        const switchBtn = chip(
          suggestion.recommended === 'step' ? 'Switch to Step' : 'Switch to Normal',
          { primary: true }
        )
        switchBtn.addEventListener('click', () => {
          coachMode = suggestion.recommended
          void window.peeki.updateSettings({ coachMode })
          syncStatusPill()
          hidePanel()
          showResult(`Mode set to ${coachModeLabel(coachMode)}. Ask again anytime.`, 'info')
        })
        panelFooter.append(switchBtn)
      }
    }
    if (suggestion.suggestAct && !actOn) {
      const actBtn = chip('Turn on Act', { primary: true })
      actBtn.addEventListener('click', () => {
        actOn = true
        void window.peeki.updateSettings({ allowProposedActions: true })
        syncStatusPill()
        showResult('Act is on. Peeki will ask before clicking.', 'info')
      })
      panelFooter.append(actBtn)
    }
    const keepBtn = chip('Not now')
    keepBtn.addEventListener('click', () => {
      hidePanel()
      void window.peeki.hideAskBar()
    })
    panelFooter.append(keepBtn)
  } else if (kind === 'ok' && lastAnswer) {
    const saveBtn = chip('Save')
    const dismiss = chip('Got it', { primary: true })
    saveBtn.addEventListener('click', () => void saveCurrentSkill())
    dismiss.addEventListener('click', () => {
      hidePanel()
      void window.peeki.hideAskBar()
    })
    panelFooter.append(saveBtn, dismiss)
  } else {
    panelFooter.hidden = true
  }

  // Keep suggestion visible longer; short info toasts dismiss quickly
  if (kind === 'info' || kind === 'ok') {
    const ms = suggestion?.askUser ? 20000 : kind === 'info' ? 2800 : 8000
    resultHideTimer = window.setTimeout(() => {
      if (panelKind === 'result' && layout === 'ask' && steps.length === 0) {
        hidePanel()
        if (kind === 'info' && !suggestion?.askUser) {
          void window.peeki.hideAskBar()
        }
      }
    }, ms)
  }
}

function showSafety(actions: ProposedAction[]): void {
  pendingActions = actions
  clearResultTimer()
  void enterAskLayout()
  hidePanel()
  openPanel('safety')
  panel.classList.add('safety')

  const title = document.createElement('div')
  title.className = 'safety-title'
  title.textContent = 'Confirm before Peeki acts'
  panelBody.appendChild(title)

  for (const action of actions) {
    const item = document.createElement('div')
    item.className = 'safety-item'
    const risk = document.createElement('div')
    risk.className = `risk ${action.risk}`
    risk.textContent = `${action.risk} · ${action.type}`
    const desc = document.createElement('div')
    desc.textContent = action.description
    item.append(risk, desc)
    panelBody.appendChild(item)
  }

  panelFooter.hidden = false
  const cancel = chip('Cancel')
  const confirm = chip('Run', { primary: true })
  cancel.addEventListener('click', () => {
    pendingActions = []
    hidePanel()
    showResult('Cancelled — nothing changed.', 'info')
  })
  confirm.addEventListener('click', () => {
    if (pendingActions.length === 0 || busy) return
    void (async () => {
      busy = true
      syncSendEnabled()
      showResult('Running…', 'info')
      try {
        const resultExec = await window.peeki.executeActions({
          actions: pendingActions,
          confirmed: true
        })
        pendingActions = []
        showResult(resultExec.message, resultExec.ok ? 'ok' : 'error')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Action failed'
        showResult(message, 'error')
      } finally {
        busy = false
        syncSendEnabled()
      }
    })()
  })
  panelFooter.append(cancel, confirm)
}

function menuRow(
  label: string,
  hint: string,
  on: boolean,
  onClick: () => void
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = on ? 'menu-row on' : 'menu-row'
  const left = document.createElement('span')
  left.textContent = label
  const right = document.createElement('span')
  right.className = 'menu-row-hint'
  right.textContent = hint
  btn.append(left, right)
  btn.addEventListener('click', onClick)
  return btn
}

function renderMenu(): void {
  clearResultTimer()
  void enterAskLayout()
  hidePanel()
  openPanel('menu')
  panelBody.replaceChildren()

  const teach = document.createElement('div')
  teach.className = 'menu-section'
  const teachLabel = document.createElement('div')
  teachLabel.className = 'menu-label'
  teachLabel.textContent = 'Teach me'
  const teachGrid = document.createElement('div')
  teachGrid.className = 'menu-grid'
  for (const preset of TEACH_PRESETS) {
    const btn = chip(preset.label)
    btn.addEventListener('click', () => {
      hidePanel()
      input.value = preset.instruction
      syncSendEnabled()
      void submitAsk(preset.instruction)
    })
    teachGrid.appendChild(btn)
  }
  teach.append(teachLabel, teachGrid)

  const toggles = document.createElement('div')
  toggles.className = 'menu-section'
  const togglesLabel = document.createElement('div')
  togglesLabel.className = 'menu-label'
  togglesLabel.textContent = 'Options'
  toggles.append(
    togglesLabel,
    menuRow('On duty', onDuty ? 'Live coaching' : 'Off', onDuty, () => {
      void setOnDuty(!onDuty, false).then(() => {
        renderMenu()
        showResult(
          onDuty
            ? 'On duty — watching your screen and coaching live.'
            : 'Off duty.',
          'info'
        )
      })
    }),
    menuRow(
      'Coach mode',
      coachModeLabel(coachMode),
      coachMode !== 'auto',
      () => {
        coachMode = cycleCoachMode()
        void window.peeki.updateSettings({ coachMode })
        syncStatusPill()
        renderMenu()
        showResult(coachModeHint(coachMode), 'info')
      }
    ),
    menuRow('Privacy blur', privacyOn ? 'On' : 'Off', privacyOn, () => {
      privacyOn = !privacyOn
      void window.peeki.updateSettings({ privacyBlurEnabled: privacyOn })
      syncStatusPill()
      renderMenu()
    }),
    menuRow(
      'Act on',
      !computerControlEnabled ? 'Disabled' : actOn ? 'On' : 'Off',
      actOn,
      () => {
        if (!computerControlEnabled) {
          showResult('Enable Computer control from the eye menu first.', 'info')
          return
        }
        actOn = !actOn
        void window.peeki.updateSettings({ allowProposedActions: actOn })
        syncStatusPill()
        renderMenu()
      }
    ),
    menuRow(
      'Clear memory',
      memoryTurnCount === 0 ? 'Empty' : `${memoryTurnCount} turns`,
      false,
      () => {
        if (busy || memoryTurnCount === 0) return
        void (async () => {
          const snapshot = await window.peeki.clearMemory()
          memoryTurnCount = snapshot.turnCount
          syncStatusPill()
          showResult('Memory cleared.', 'info')
        })()
      }
    )
  )

  const library = document.createElement('div')
  library.className = 'menu-section'
  const libraryLabel = document.createElement('div')
  libraryLabel.className = 'menu-label'
  libraryLabel.textContent = 'Library'
  const libraryGrid = document.createElement('div')
  libraryGrid.className = 'menu-grid'
  const skillsBtn = chip('Skills')
  const historyBtn = chip('History')
  skillsBtn.addEventListener('click', () => void renderSkills())
  historyBtn.addEventListener('click', () => void renderHistory())
  libraryGrid.append(skillsBtn, historyBtn)
  library.append(libraryLabel, libraryGrid)

  panelBody.append(teach, toggles, library)
}

async function saveCurrentSkill(): Promise<void> {
  if (!lastAnswer) {
    showResult('Ask first, then save.', 'info')
    return
  }
  const defaultName =
    lastAnswer.instruction.slice(0, 48).trim() ||
    lastAnswer.screenSummary?.slice(0, 48).trim() ||
    'Saved skill'
  const name = window.prompt('Name this skill', defaultName)
  if (!name || !name.trim()) return
  try {
    const skill = await window.peeki.saveSkill({
      name: name.trim(),
      instruction: lastAnswer.instruction,
      guidance: lastAnswer.guidance,
      steps:
        lastAnswer.steps.length > 0
          ? lastAnswer.steps
          : [lastAnswer.guidance].filter(Boolean),
      highlights: lastAnswer.highlights,
      screenSummary: lastAnswer.screenSummary
    })
    showResult(`Saved “${skill.name}”.`, 'ok')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save skill'
    showResult(message, 'error')
  }
}

async function replaySkill(skill: SavedSkill): Promise<void> {
  lastAnswer = {
    instruction: skill.instruction,
    guidance: skill.guidance,
    steps: skill.steps.length > 0 ? skill.steps : [skill.guidance],
    highlights: skill.highlights,
    screenSummary: skill.screenSummary
  }
  steps = lastAnswer.steps
  stepIndex = 0
  speak(steps[0] ?? skill.guidance)
  if (skill.highlights.length > 0) {
    await window.peeki.showHighlights({
      highlights: skill.highlights,
      stepIndex: 0,
      autoHideMs: 0
    })
  }
  await startCoaching()
}

async function renderSkills(): Promise<void> {
  void enterAskLayout()
  hidePanel()
  openPanel('skills')
  panelBody.textContent = 'Loading…'
  panelFooter.hidden = false
  const back = chip('Back')
  back.addEventListener('click', () => renderMenu())
  panelFooter.appendChild(back)

  try {
    const skills = await window.peeki.listSkills()
    if (skills.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'library-empty'
      empty.textContent = 'No skills yet. Save one after an answer.'
      panelBody.replaceChildren(empty)
      return
    }
    panelBody.replaceChildren()
    for (const skill of skills) {
      const item = document.createElement('div')
      item.className = 'library-item'
      const title = document.createElement('div')
      title.className = 'library-item-title'
      title.textContent = skill.name
      const meta = document.createElement('div')
      meta.className = 'library-item-meta'
      meta.textContent = `${skill.steps.length || 1} steps`
      const actions = document.createElement('div')
      actions.className = 'library-item-actions'
      const play = chip('Replay', { primary: true })
      const remove = chip('Delete')
      play.addEventListener('click', () => void replaySkill(skill))
      remove.addEventListener('click', () => {
        void (async () => {
          await window.peeki.deleteSkill(skill.id)
          await renderSkills()
        })()
      })
      actions.append(play, remove)
      item.append(title, meta, actions)
      panelBody.appendChild(item)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load skills'
    panelBody.textContent = message
  }
}

async function renderHistory(): Promise<void> {
  void enterAskLayout()
  hidePanel()
  openPanel('history')
  panelBody.textContent = 'Loading…'
  panelFooter.hidden = false
  panelFooter.classList.add('space-between')
  const back = chip('Back')
  back.addEventListener('click', () => renderMenu())
  const clear = chip('Clear')
  clear.addEventListener('click', () => {
    void (async () => {
      await window.peeki.clearHistory()
      await renderHistory()
    })()
  })
  panelFooter.append(back, clear)

  try {
    const entries = await window.peeki.listHistory(20)
    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'library-empty'
      empty.textContent = 'No history yet.'
      panelBody.replaceChildren(empty)
      return
    }
    panelBody.replaceChildren()
    for (const entry of entries) {
      appendHistoryItem(entry)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load history'
    panelBody.textContent = message
  }
}

function appendHistoryItem(entry: HistoryEntry): void {
  const item = document.createElement('div')
  item.className = 'library-item'
  const title = document.createElement('div')
  title.className = 'library-item-title'
  title.textContent = entry.instruction.slice(0, 80)
  const meta = document.createElement('div')
  meta.className = 'library-item-meta'
  meta.textContent = `${new Date(entry.createdAt).toLocaleString()}\n${entry.guidance.slice(0, 120)}`
  const actions = document.createElement('div')
  actions.className = 'library-item-actions'
  const reuse = chip('Ask again')
  reuse.addEventListener('click', () => {
    hidePanel()
    input.value = entry.instruction
    syncSendEnabled()
    void submitAsk(entry.instruction)
  })
  actions.appendChild(reuse)
  item.append(title, meta, actions)
  panelBody.appendChild(item)
}

async function showHighlightsForDecision(
  decision: AgentDecision,
  mode: CoachMode,
  captureMeta?: {
    displayBounds?: {
      x: number
      y: number
      width: number
      height: number
    }
    coordMap?: {
      offsetX: number
      offsetY: number
      width: number
      height: number
    }
  },
  debugOverlay = false
): Promise<void> {
  const hasAbs = (decision.absoluteMarks?.length ?? 0) > 0
  const hasNorm = decision.highlights.length > 0
  if (!hasAbs && !hasNorm) {
    await window.peeki.hideHighlights()
    return
  }
  await window.peeki.showHighlights({
    highlights: hasAbs ? [] : decision.highlights,
    absoluteMarks: decision.absoluteMarks,
    stepIndex: !hasAbs && mode === 'step' ? 0 : undefined,
    autoHideMs: mode === 'step' ? 0 : 16000,
    displayBounds: captureMeta?.displayBounds,
    coordMap: captureMeta?.coordMap,
    debugOverlay
  })
}

async function refreshSettings(): Promise<void> {
  try {
    const settings = await window.peeki.getSettings()
    coachMode = settings.coachMode
    privacyOn = settings.privacyBlurEnabled
    voiceReplyEnabled = settings.voiceReplyEnabled
    actOn = settings.allowProposedActions
    computerControlEnabled = settings.computerControlEnabled
    debugScreenIntel = Boolean(settings.debugScreenIntel)
    onDuty = Boolean(settings.watchEnabled)
  } catch {
    // keep defaults
  }
  syncStatusPill()
}

async function refreshApiStatus(): Promise<void> {
  try {
    const status = await window.peeki.getStatus()
    hasApiKey = status.hasApiKey
    memoryTurnCount = status.memoryTurnCount
    privacyOn = status.privacyBlurEnabled
    coachMode = status.coachMode
    computerControlEnabled = status.computerControlEnabled
    onDuty = Boolean(status.watchEnabled)
    if (!hasApiKey) {
      // Non-blocking: local answers still work
      console.info('No OpenAI key — local screen answers still work; vision needs a key.')
    }
  } catch {
    hasApiKey = false
  }
  syncSendEnabled()
  syncStatusPill()
}

async function submitAsk(presetInstruction?: string): Promise<void> {
  const instruction = (presetInstruction ?? input.value).trim()
  if (!instruction || busy) return

  // Local answers (inventory / UIA locate) work without an API key.
  // Vision / coaching still need one — the agent returns a clear error then.
  if (!hasApiKey) {
    await refreshApiStatus()
  }

  await enterAskLayout()
  busy = true
  sendBtn.classList.add('busy')
  syncSendEnabled()
  showResult('Looking…', 'info')
  await window.peeki.hideHighlights()
  lastAnswer = null
  steps = []
  stepIndex = 0
  pendingActions = []

  try {
    const response = await window.peeki.runAgent({
      instruction,
      allowProposedActions: actOn && computerControlEnabled,
      mode: coachMode
    })

    if (typeof response.memoryTurnCount === 'number') {
      memoryTurnCount = response.memoryTurnCount
      syncStatusPill()
    }

    if (!response.ok) {
      showResult(response.error, 'error')
      return
    }

    const { decision, mode } = response
    lastAnswer = {
      instruction,
      guidance: decision.guidance,
      steps: decision.steps,
      highlights: decision.highlights,
      screenSummary: decision.screenSummary
    }

    await showHighlightsForDecision(
      decision,
      mode,
      {
        displayBounds: response.capture.displayBounds,
        coordMap: response.capture.coordMap
      },
      debugScreenIntel
    )

    const suggestion = decision.modeSuggestion
    const localTag = decision.usedLocalAnswer ? ' · free (no AI)' : ''

    if (decision.proposedActions.length > 0) {
      showSafety(decision.proposedActions)
      speak(decision.nextStep || decision.guidance)
    } else if (mode === 'step' && decision.steps.length > 0) {
      steps = decision.steps
      stepIndex = 0
      speak(decision.steps[0] ?? decision.guidance)
      await startCoaching()
      if (suggestion?.askUser) {
        // After coach starts, still surface mode pin offer briefly in panel
        // Keep coaching primary — suggestion can wait for next ask via menu
      }
    } else if (decision.steps.length > 1) {
      steps = decision.steps
      stepIndex = 0
      speak(decision.steps[0] ?? decision.guidance)
      await startCoaching()
    } else {
      speak(decision.nextStep || decision.guidance)
      const debugNote =
        debugScreenIntel && decision.debugMapText
          ? `\n\n—— DEBUG ——\n${decision.debugMapText}`
          : ''
      showResult(
        decision.guidance + debugNote,
        'ok',
        (decision.nextStep ? `Next: ${decision.nextStep}` : 'Done') + localTag,
        suggestion
      )
    }

    input.value = ''
    input.style.height = 'auto'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong'
    showResult(message, 'error')
  } finally {
    busy = false
    sendBtn.classList.remove('busy')
    syncSendEnabled()
    if (layout === 'ask') autofocus()
  }
}

function getSpeechRecognition(): SpeechRec | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRec
    webkitSpeechRecognition?: new () => SpeechRec
  }
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  if (!Ctor) return null
  return new Ctor()
}

function toggleVoice(): void {
  if (listening && recognition) {
    recognition.stop()
    listening = false
    syncVoiceLabel()
    return
  }

  recognition = getSpeechRecognition()
  if (!recognition) {
    showResult('Voice not available here.', 'error')
    return
  }

  recognition.lang = 'en-US'
  recognition.continuous = false
  recognition.interimResults = false
  recognition.onresult = (event) => {
    const transcript = event.results[0]?.[0]?.transcript?.trim()
    if (transcript) {
      input.value = transcript
      syncSendEnabled()
      void submitAsk(transcript)
    }
  }
  recognition.onerror = () => {
    listening = false
    syncVoiceLabel()
  }
  recognition.onend = () => {
    listening = false
    syncVoiceLabel()
  }

  listening = true
  syncVoiceLabel()
  recognition.start()
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  void submitAsk()
})

plusBtn.addEventListener('click', () => {
  if (panelKind === 'menu' || panelKind === 'skills' || panelKind === 'history') {
    hidePanel()
    return
  }
  renderMenu()
})

voiceBtn.addEventListener('click', () => {
  toggleVoice()
})

coachBack.addEventListener('click', () => {
  if (stepIndex <= 0) return
  stepIndex -= 1
  renderCoachDock()
  speak(steps[stepIndex] ?? '')
  void window.peeki.setHighlightStep(stepIndex)
})

coachNext.addEventListener('click', () => {
  if (stepIndex >= steps.length - 1) return
  stepIndex += 1
  renderCoachDock()
  speak(steps[stepIndex] ?? '')
  void window.peeki.setHighlightStep(stepIndex)
})

coachAsk.addEventListener('click', () => {
  void (async () => {
    document.body.classList.remove('is-coach')
    coach.hidden = true
    await enterAskLayout()
    autofocus()
  })()
})

coachDone.addEventListener('click', () => {
  void endCoaching(true)
})

input.addEventListener('input', () => {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 88)}px`
  syncSendEnabled()
})

input.addEventListener('keydown', (event) => {
  if (event.isComposing) return
  if ((event.key === 'Enter' || event.code === 'Enter' || event.keyCode === 13) && !event.shiftKey) {
    event.preventDefault()
    event.stopPropagation()
    if (!busy && input.value.trim()) {
      void submitAsk()
    }
    return
  }
  if (event.key === 'Escape') {
    void window.peeki.hideAskBar()
    void window.peeki.hideHighlights()
  }
})

backdrop.addEventListener('mousedown', () => {
  if (panelKind === 'safety') return
  void window.peeki.hideAskBar()
})

window.addEventListener('keydown', (event) => {
  if (event.isComposing) return
  if (layout === 'coach' && (event.key === 'Enter' || event.code === 'Enter')) {
    event.preventDefault()
    if (stepIndex < steps.length - 1) {
      coachNext.click()
    } else {
      coachDone.click()
    }
    return
  }
  if (event.key === 'Escape') {
    if (layout === 'coach') {
      void endCoaching(true)
      return
    }
    void window.peeki.hideAskBar()
    void window.peeki.hideHighlights()
  }
})

window.peeki.onAskBarFocus(() => {
  clearResultTimer()
  document.body.classList.remove('is-coach')
  coach.hidden = true
  hidePanel()
  layout = 'ask'
  void refreshApiStatus().then(() => {
    if (hasApiKey) autofocus()
  })
})

window.peeki.onAskBarLayout((next) => {
  layout = next
  document.body.classList.toggle('is-coach', next === 'coach')
  if (next === 'coach') {
    coach.hidden = steps.length === 0
    renderCoachDock()
  } else {
    coach.hidden = true
  }
})

window.peeki.onWatchNudge((payload) => {
  void (async () => {
    await enterAskLayout()
    showResult(
      payload.guidance,
      'info',
      payload.nextStep ? `Coach tip · ${payload.nextStep}` : 'Live coach'
    )
    speak(payload.guidance)
    const hasAbs = (payload.absoluteMarks?.length ?? 0) > 0
    if (hasAbs || payload.highlights.length > 0) {
      await window.peeki.showHighlights({
        highlights: hasAbs ? [] : payload.highlights,
        absoluteMarks: payload.absoluteMarks,
        autoHideMs: 14000
      })
    }
    if (payload.proposedActions.length > 0 && actOn) {
      showSafety(payload.proposedActions)
    }
  })()
})

window.peeki.onWatchState(({ enabled }) => {
  onDuty = enabled
  syncStatusPill()
})

syncSendEnabled()
syncVoiceLabel()
syncStatusPill()
void refreshSettings()
void refreshApiStatus().then(() => autofocus())
