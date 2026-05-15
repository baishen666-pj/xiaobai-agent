import { useState } from 'react';
import { useWebSocket, type OrchestratorWSMessage } from './hooks/useWebSocket.js';
import { AgentStatusPanel } from './components/AgentStatusPanel.js';
import { TaskFlowView } from './components/TaskFlowView.js';
import { TokenUsageChart } from './components/TokenUsageChart.js';
import { EventLog } from './components/EventLog.js';
import './App.css';

export function App() {
  const [url, setUrl] = useState('ws://localhost:3001');
  const { connected, events, agents, tasks, tokenTotal, connect, disconnect } =
    useWebSocket(url);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Xiaobai Agent Dashboard</h1>
        <div className="connection-controls">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="WebSocket URL"
            className="ws-input"
          />
          {connected ? (
            <button className="btn btn-disconnect" onClick={disconnect}>
              Disconnect
            </button>
          ) : (
            <button className="btn btn-connect" onClick={connect}>
              Connect
            </button>
          )}
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="panel agents-panel">
          <h2>Agents</h2>
          <AgentStatusPanel agents={agents} />
        </section>

        <section className="panel tasks-panel">
          <h2>Tasks</h2>
          <TaskFlowView tasks={tasks} />
        </section>

        <section className="panel tokens-panel">
          <h2>Tokens</h2>
          <TokenUsageChart total={tokenTotal} tasks={tasks} />
        </section>

        <section className="panel events-panel">
          <h2>Event Log</h2>
          <EventLog events={events} />
        </section>
      </div>
    </div>
  );
}
