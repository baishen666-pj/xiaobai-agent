import { useLocalStorage } from './hooks/useLocalStorage.js';
import { useWebSocket, type OrchestratorWSMessage } from './hooks/useWebSocket.js';
import { AgentStatusPanel } from './components/AgentStatusPanel.js';
import { TaskFlowView } from './components/TaskFlowView.js';
import { TokenUsageChart } from './components/TokenUsageChart.js';
import { EventLog } from './components/EventLog.js';
import { ChatEventPanel } from './components/ChatEventPanel.js';
import { EventFilterBar } from './components/EventFilterBar.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { ChartPanel } from './components/ChartPanel.js';
import { SummaryCards } from './components/SummaryCards.js';
import './App.css';

export function App() {
  const [url, setUrl] = useLocalStorage('xiaobai-ws-url', 'ws://localhost:3001');
  const [theme, setTheme] = useLocalStorage<'dark' | 'light'>('xiaobai-theme', 'dark');
  const {
    connected, events, agents, tasks, tokenTotal,
    chatMessages, chatTokenTotal, eventFilter,
    tokenHistory, progressEvents,
    connect, disconnect, setEventFilter,
  } = useWebSocket(url);

  const filteredEvents = eventFilter === 'all' ? events :
    eventFilter === 'error' ? events.filter((e) => e.type.includes('error') || e.type.includes('fail')) :
      events.filter((e) => e.type.startsWith(eventFilter));

  return (
    <div className={`dashboard ${theme}`} data-theme={theme}>
      <header className="dashboard-header">
        <h1>Xiaobai Agent Dashboard</h1>
        <div className="connection-controls">
          <ThemeToggle
            theme={theme}
            onToggle={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
          />
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

      <div className="summary-cards">
        <SummaryCards
          agents={agents}
          tasks={tasks}
          tokenTotal={tokenTotal}
          chatTokenTotal={chatTokenTotal}
          eventCount={events.length}
        />
      </div>

      <div className="dashboard-grid">
        <section className="panel agents-panel">
          <h2>Agents</h2>
          <AgentStatusPanel agents={agents} />
        </section>

        <section className="panel tasks-panel">
          <h2>Tasks</h2>
          <TaskFlowView tasks={tasks} progressEvents={progressEvents} />
        </section>

        <section className="panel chat-panel">
          <h2>Chat</h2>
          <ChatEventPanel messages={chatMessages} tokenTotal={chatTokenTotal} />
        </section>

        <section className="panel tokens-panel">
          <h2>Tokens</h2>
          <TokenUsageChart total={tokenTotal} tasks={tasks} tokenHistory={tokenHistory} />
          <ChartPanel tokenHistory={tokenHistory} tasks={tasks} />
        </section>

        <section className="panel events-panel span-two">
          <div className="events-header">
            <h2>Event Log</h2>
            <EventFilterBar filter={eventFilter} onFilterChange={setEventFilter} />
          </div>
          <EventLog events={filteredEvents} />
        </section>
      </div>
    </div>
  );
}
