import { useState } from 'react';
import type { ClientMessage, AgentInfo, ServerAck } from '../types.js';

interface Props {
  send: (msg: ClientMessage) => void;
  connected: boolean;
  agents: AgentInfo[];
  sessionId: string;
  onSessionChange: (id: string) => void;
}

export function AgentControlPanel({ send, connected, agents, sessionId, onSessionChange }: Props) {
  const [taskPrompt, setTaskPrompt] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [sessions, setSessions] = useState<Array<{ id: string; createdAt: number; updatedAt: number; messageCount: number }>>([]);
  const [showSessions, setShowSessions] = useState(false);

  const handleStartTask = () => {
    const trimmed = taskPrompt.trim();
    if (!trimmed || !connected) return;
    send({ type: 'task_start', prompt: trimmed, model: model || undefined, provider: provider || undefined });
    setTaskPrompt('');
  };

  const handleCancel = () => {
    if (!connected || !sessionId) return;
    send({ type: 'task_cancel', sessionId });
  };

  const handleModelChange = () => {
    if (!connected || (!model && !provider)) return;
    send({ type: 'model_select', provider: provider || 'openai', model: model || 'gpt-4' });
  };

  const handleNewSession = () => {
    if (!connected) return;
    send({ type: 'session_create' });
  };

  const handleListSessions = () => {
    if (!connected) return;
    send({ type: 'session_list' });
    setShowSessions(true);
  };

  const handleResumeSession = (id: string) => {
    if (!connected) return;
    send({ type: 'session_resume', sessionId: id });
    onSessionChange(id);
    setShowSessions(false);
  };

  const busyAgents = agents.filter((a) => a.busy).length;

  return (
    <div className="agent-control-panel">
      <div className="control-section">
        <h3>Task Control</h3>
        <div className="control-row">
          <input
            className="control-input"
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder="Task prompt..."
            disabled={!connected}
          />
          <button className="btn btn-start" onClick={handleStartTask} disabled={!connected || !taskPrompt.trim()}>
            Start
          </button>
          <button className="btn btn-cancel" onClick={handleCancel} disabled={!connected || !sessionId}>
            Cancel
          </button>
        </div>
      </div>

      <div className="control-section">
        <h3>Model</h3>
        <div className="control-row">
          <input
            className="control-input-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="Provider"
            disabled={!connected}
          />
          <input
            className="control-input-sm"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model"
            disabled={!connected}
          />
          <button className="btn btn-secondary" onClick={handleModelChange} disabled={!connected}>
            Apply
          </button>
        </div>
      </div>

      <div className="control-section">
        <h3>Sessions</h3>
        <div className="control-row">
          <button className="btn btn-secondary" onClick={handleNewSession} disabled={!connected}>
            New
          </button>
          <button className="btn btn-secondary" onClick={handleListSessions} disabled={!connected}>
            List
          </button>
        </div>
        {showSessions && sessions.length > 0 && (
          <div className="session-list">
            {sessions.map((s) => (
              <button
                key={s.id}
                className={`session-item ${s.id === sessionId ? 'active' : ''}`}
                onClick={() => handleResumeSession(s.id)}
              >
                <span className="session-id">{s.id.slice(0, 20)}</span>
                <span className="session-meta">{s.messageCount} msgs</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="control-status">
        <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
        <span>{busyAgents > 0 ? `${busyAgents} busy` : 'Idle'}</span>
      </div>
    </div>
  );
}
