import { useEffect, useRef } from 'react';
import { ExpandableMessage } from './ExpandableMessage.js';
import type { ChatMessage } from '../hooks/useWebSocket.js';

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
              <div className="chat-bubble user-bubble">
                <ExpandableMessage content={msg.content} maxLength={150} />
              </div>
            )}
            {msg.type === 'assistant' && (
              <div className="chat-bubble assistant-bubble">
                <ExpandableMessage content={msg.content} maxLength={300} />
              </div>
            )}
            {msg.type === 'tool_call' && (
              <div className="chat-bubble tool-bubble">
                <span className="tool-label">TOOL</span> {msg.toolName}
              </div>
            )}
            {msg.type === 'tool_result' && (
              <div className={`chat-bubble tool-result-bubble ${msg.success ? 'success' : 'fail'}`}>
                <span className="tool-label">{msg.success ? 'OK' : 'FAIL'}</span> {msg.toolName}
                {msg.content && (
                  <div className="tool-output">
                    <ExpandableMessage content={msg.content} maxLength={100} />
                  </div>
                )}
              </div>
            )}
            {msg.type === 'error' && (
              <div className="chat-bubble error-bubble">
                <ExpandableMessage content={msg.content} maxLength={150} />
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
