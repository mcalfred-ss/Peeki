import type { JSX } from 'react'
import type { AgentDecision } from '../../../../modules/shared'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
  decision?: AgentDecision
}

type Props = {
  messages: ChatMessage[]
}

export function ChatLog({ messages }: Props): JSX.Element {
  if (messages.length === 0) {
    return (
      <div className="chat-log">
        <div className="empty-state">
          Ask Peeki what you see on screen, how to finish a task, or what to do next.
          Your screenshot is sent only when you run an instruction.
        </div>
      </div>
    )
  }

  return (
    <div className="chat-log">
      {messages.map((message) => (
        <div key={message.id} className={`bubble ${message.role}`}>
          {message.text}
          {message.decision && (
            <div className="meta">
              <div>
                <strong>Screen:</strong> {message.decision.screenSummary}
              </div>
              <div>
                <strong>Goal:</strong> {message.decision.userGoal}
              </div>
              {message.decision.nextStep && (
                <div>
                  <strong>Next:</strong> {message.decision.nextStep}
                </div>
              )}
              <div>
                <strong>Confidence:</strong>{' '}
                {Math.round(message.decision.confidence * 100)}%
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
