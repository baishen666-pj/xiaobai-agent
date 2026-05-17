import { useState, useRef, useEffect } from 'react';
import { ChatEventPanel } from './ChatEventPanel.js';
import type { ChatMessage, ClientMessage } from '../types.js';

interface Props {
  messages: ChatMessage[];
  tokenTotal: number;
  send: (msg: ClientMessage) => void;
  connected: boolean;
  sessionId: string;
}

export function ChatPanel({ messages, tokenTotal, send, connected, sessionId }: Props) {
  const [input, setInput] = useState('');

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !connected) return;
    send({ type: 'chat_send', sessionId, content: trimmed });
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel-full">
      <ChatEventPanel messages={messages} tokenTotal={tokenTotal} />
      <div className="chat-input-area">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={connected ? 'Type a message...' : 'Connect to start chatting'}
          disabled={!connected}
          rows={2}
        />
        <button
          className="btn btn-send"
          onClick={handleSend}
          disabled={!connected || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
