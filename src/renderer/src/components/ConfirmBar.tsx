import type { JSX } from 'react'

type Props = {
  count: number
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmBar({ count, busy, onConfirm, onCancel }: Props): JSX.Element {
  return (
    <div className="confirm-banner">
      <span>
        Peeki proposed {count} action{count === 1 ? '' : 's'}. Nothing runs until you confirm.
      </span>
      <div className="btn-row">
        <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
          Dismiss
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={onConfirm}>
          Run actions
        </button>
      </div>
    </div>
  )
}
