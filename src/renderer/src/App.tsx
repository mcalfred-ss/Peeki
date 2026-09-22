import { useEffect, useState, type JSX } from 'react'
import type {
  AgentDecision,
  AppSettings,
  AppStatus,
  ProposedAction,
  ScreenCapture
} from '../../../modules/shared'
import { ChatLog, type ChatMessage } from './components/ChatLog'
import { ScreenPreview } from './components/ScreenPreview'
import { Composer } from './components/Composer'
import { ConfirmBar } from './components/ConfirmBar'
import logoUrl from './assets/peeki-logo.jpg'

export default function App(): JSX.Element {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [capture, setCapture] = useState<ScreenCapture | null>(null)
  const [pendingActions, setPendingActions] = useState<ProposedAction[]>([])
  const [busy, setBusy] = useState(false)
  const [instruction, setInstruction] = useState('')

  useEffect(() => {
    void (async () => {
      const [appStatus, appSettings] = await Promise.all([
        window.peeki.getStatus(),
        window.peeki.getSettings()
      ])
      setStatus(appStatus)
      setSettings(appSettings)
    })()
  }, [])

  async function handleCaptureOnly(): Promise<void> {
    setBusy(true)
    try {
      const shot = await window.peeki.captureScreen()
      setCapture(shot)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Capture failed'
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'error', text: message }])
    } finally {
      setBusy(false)
    }
  }

  async function handleRun(): Promise<void> {
    const text = instruction.trim()
    if (!text || busy) return

    setBusy(true)
    setPendingActions([])
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', text }
    ])
    setInstruction('')

    try {
      const result = await window.peeki.runAgent({
        instruction: text,
        allowProposedActions: settings?.allowProposedActions ?? false
      })

      if (!result.ok) {
        if (result.capture) setCapture(result.capture)
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'error', text: result.error }
        ])
        return
      }

      setCapture(result.capture)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: result.decision.guidance,
          decision: result.decision
        }
      ])

      if (result.decision.proposedActions.length > 0) {
        setPendingActions(result.decision.proposedActions)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent run failed'
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'error', text: message }])
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmActions(confirmed: boolean): Promise<void> {
    if (pendingActions.length === 0) return
    setBusy(true)
    try {
      const result = await window.peeki.executeActions({
        actions: pendingActions,
        confirmed
      })
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: result.ok ? 'assistant' : 'error',
          text: result.message
        }
      ])
      setPendingActions([])
    } finally {
      setBusy(false)
    }
  }

  async function toggleSetting(
    key: keyof Pick<
      AppSettings,
      'allowProposedActions' | 'sendScreenByDefault' | 'overlayVisible'
    >,
    value: boolean
  ): Promise<void> {
    const next = await window.peeki.updateSettings({ [key]: value })
    setSettings(next)
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            overlayVisible: next.overlayVisible
          }
        : prev
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-row">
            <img className="brand-logo" src={logoUrl} alt="" />
            <h1>Peeki</h1>
          </div>
          <p>Sees your screen. Guides the next step. Asks before acting.</p>
        </div>
        <div className="status-pill" title="API configuration status">
          <span className={`status-dot ${status?.hasApiKey ? 'ok' : ''}`} />
          {status?.hasApiKey ? 'API ready' : 'Add OPENAI_API_KEY'}
        </div>
      </header>

      <div className="main">
        <section className="panel">
          <div className="panel-header">Guidance</div>
          <ChatLog messages={messages} />
        </section>

        <section className="panel">
          <div className="panel-header">Screen</div>
          <ScreenPreview
            capture={capture}
            pendingActions={pendingActions}
          />
        </section>
      </div>

      {pendingActions.length > 0 && (
        <ConfirmBar
          count={pendingActions.length}
          busy={busy}
          onConfirm={() => void handleConfirmActions(true)}
          onCancel={() => void handleConfirmActions(false)}
        />
      )}

      <Composer
        value={instruction}
        busy={busy}
        settings={settings}
        onChange={setInstruction}
        onRun={() => void handleRun()}
        onCapture={() => void handleCaptureOnly()}
        onToggle={toggleSetting}
      />
    </div>
  )
}

export type { AgentDecision }
