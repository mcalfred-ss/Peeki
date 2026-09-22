import type { JSX } from 'react'
import type { ProposedAction, ScreenCapture } from '../../../../modules/shared'

type Props = {
  capture: ScreenCapture | null
  pendingActions: ProposedAction[]
}

export function ScreenPreview({ capture, pendingActions }: Props): JSX.Element {
  return (
    <div className="preview-body">
      <div className="preview-frame">
        {capture ? (
          <img src={capture.dataUrl} alt="Latest screen capture" />
        ) : (
          <span>No capture yet. Run an instruction or preview the screen.</span>
        )}
      </div>

      {pendingActions.length > 0 && (
        <div className="actions-list">
          {pendingActions.map((action) => (
            <div key={action.id} className="action-item">
              <div className="risk">{action.risk} · {action.type}</div>
              <div>{action.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
