import type { JSX } from 'react'
import type { AppSettings } from '../../../../modules/shared'

type Props = {
  value: string
  busy: boolean
  settings: AppSettings | null
  onChange: (value: string) => void
  onRun: () => void
  onCapture: () => void
  onToggle: (
    key: keyof Pick<
      AppSettings,
      'allowProposedActions' | 'sendScreenByDefault' | 'overlayVisible'
    >,
    value: boolean
  ) => Promise<void>
}

export function Composer({
  value,
  busy,
  settings,
  onChange,
  onRun,
  onCapture,
  onToggle
}: Props): JSX.Element {
  return (
    <div className="composer">
      <textarea
        value={value}
        disabled={busy}
        placeholder="e.g. What am I looking at? How do I export this file?"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!busy && value.trim()) onRun()
          }
        }}
      />
      <div className="composer-row">
        <div className="toggles">
          <label>
            <input
              type="checkbox"
              checked={settings?.overlayVisible ?? true}
              disabled={busy || !settings}
              onChange={(e) => void onToggle('overlayVisible', e.target.checked)}
            />
            Show floating eye
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings?.allowProposedActions ?? false}
              disabled={busy || !settings}
              onChange={(e) => void onToggle('allowProposedActions', e.target.checked)}
            />
            Propose actions (confirm before run)
          </label>
        </div>
        <div className="btn-row">
          <button type="button" className="btn ghost" disabled={busy} onClick={onCapture}>
            Preview screen
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !value.trim()}
            onClick={onRun}
          >
            {busy ? 'Working…' : 'Ask Peeki'}
          </button>
        </div>
      </div>
    </div>
  )
}
