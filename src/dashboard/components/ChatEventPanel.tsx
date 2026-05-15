import { useEffect, useRef } from 'react';

export interface ChatMessage {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error';
  content: string;
  toolName?: string;
  success?: boolean;
  tokens?: number;
  timestamp: number;
}

interface Props {
  messages: ChatMessage[];
  tokenTotal: number;
}

export function ChatEventPanel({ messages, tokenTotal }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="chat-panel-inner">
      <div className="chat-token-counter">
        Tokens: <span className="chat-token-value">{tokenTotal.toLocaleString()}</span>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-state">No chat events yet</div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.type}`}>
            {msg.type === 'user' && (
              <div className="chat-bubble user-bubble">{msg.content}</div>
            )}
            {msg.type === 'assistant' && (
              <div className="chat-bubble assistant-bubble">{msg.content}</div>
            )}
            {msg.type === 'tool_call' && (
              <div className="chat-bubble tool-bubble">
                <span className="tool-label">TOOL</span> {msg.toolName}
              </div>
            )}
            {msg.type === 'tool_result' && (
              <div className={`chat-bubble tool-result-bubble ${msg.success ? 'success' : 'fail'}`}>
                <span className="tool-label">{msg.success ? 'OK' : 'FAIL'}</span> {msg.toolName}
              </div>
            )}
            {msg.type === 'error' && (
              <div className="chat-bubble error-bubble">{msg.content}</div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
