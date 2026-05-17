import { useState, useEffect, useCallback, useRef } from 'react';
import { createApiClient, type ApiError } from '../lib/api.js';
import type { ChatMessage as DashboardChatMessage } from '../types.js';

const api = createApiClient();

interface PlaygroundMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: number;
}

type ResourceTab = 'models' | 'tools' | 'plugins';

export function PlaygroundPage() {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resourceTab, setResourceTab] = useState<ResourceTab>('models');
  const [models, setModels] = useState<string[]>([]);
  const [tools, setTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [plugins, setPlugins] = useState<Array<{ name: string }>>([]);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [m, t, p] = await Promise.all([
          api.getModels(controller.signal),
          api.getTools(controller.signal),
          api.getPlugins(controller.signal),
        ]);
        setModels(m.providers);
        setTools(t.tools);
        setPlugins(p.plugins);
      } catch {
        // Resources load silently
      }
    })();
    return () => controller.abort();
  }, []);

  const sendChat = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMsg: PlaygroundMessage = { role: 'user', content: trimmed, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const result = await api.chat(trimmed, model ? { model } : undefined);
      setMessages((prev) => [...prev, { role: 'assistant', content: result.content, timestamp: result.timestamp }]);
    } catch (err) {
      setError((err as ApiError).error || 'Chat failed');
      setMessages((prev) => [...prev, { role: 'error', content: (err as ApiError).error || 'Chat failed', timestamp: Date.now() }]);
    } finally {
      setSending(false);
    }
  }, [input, model]);

  const streamChat = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMsg: PlaygroundMessage = { role: 'user', content: trimmed, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const assistantMsg: PlaygroundMessage = { role: 'assistant', content: '', timestamp: Date.now() };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, ...(model ? { model } : {}) }),
        signal: controller.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]\n') continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            if (chunk.type === 'error') {
              setError(chunk.error);
            } else if (chunk.content) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + chunk.content };
                }
                return updated;
              });
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('Stream failed');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, model]);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="playground-page">
      <div className="page-header">
        <h1>Playground</h1>
      </div>

      <div className="playground-layout">
        <div className="resource-browser">
          <div className="resource-tabs">
            {(['models', 'tools', 'plugins'] as ResourceTab[]).map((tab) => (
              <button
                key={tab}
                className={`resource-tab ${resourceTab === tab ? 'active' : ''}`}
                onClick={() => setResourceTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="resource-content">
            {resourceTab === 'models' && (
              <ul className="resource-list">
                {models.map((m) => <li key={m} className="resource-item">{m}</li>)}
                {models.length === 0 && <li className="resource-empty">No models</li>}
              </ul>
            )}
            {resourceTab === 'tools' && (
              <ul className="resource-list">
                {tools.map((t) => (
                  <li key={t.name} className="resource-item">
                    <strong>{t.name}</strong>
                    {t.description && <p className="resource-desc">{t.description}</p>}
                  </li>
                ))}
                {tools.length === 0 && <li className="resource-empty">No tools</li>}
              </ul>
            )}
            {resourceTab === 'plugins' && (
              <ul className="resource-list">
                {plugins.map((p) => <li key={p.name} className="resource-item">{p.name}</li>)}
                {plugins.length === 0 && <li className="resource-empty">No plugins</li>}
              </ul>
            )}
          </div>
        </div>

        <div className="playground-chat">
          <div className="chat-input-bar">
            <select value={model} onChange={(e) => setModel(e.target.value)} className="model-select">
              <option value="">Default model</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
            />
            <button className="btn btn-connect" onClick={sendChat} disabled={sending || streaming}>
              Send
            </button>
            <button className="btn btn-connect" onClick={streamChat} disabled={sending || streaming}>
              Stream
            </button>
            {streaming && (
              <button className="btn btn-disconnect" onClick={stopStream}>Stop</button>
            )}
          </div>

          <div className="playground-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`playground-message ${msg.role}`}>
                <span className="message-role">{msg.role}</span>
                <pre className="message-content">{msg.content}</pre>
              </div>
            ))}
            {messages.length === 0 && <div className="page-empty">Send a message to start chatting</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
