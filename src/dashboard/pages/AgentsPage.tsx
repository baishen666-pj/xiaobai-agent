import { useDashboardContext } from '../hooks/useDashboardContext.js';
import { AgentStatusPanel } from '../components/AgentStatusPanel.js';
import { AgentControlPanel } from '../components/AgentControlPanel.js';
import { AgentActivitySparkline } from '../components/AgentActivitySparkline.js';
import { RoleDistributionChart } from '../components/RoleDistributionChart.js';

export function AgentsPage() {
  const { agents, tasks, connected, send, activeSessionId, setActiveSessionId, events } = useDashboardContext();

  const agentEvents = (agentId: string) =>
    events.filter((e) => e.message.includes(agentId)).slice(-20);

  return (
    <div className="agents-page">
      <div className="page-header">
        <h1>Agents</h1>
        <span className="page-subtitle">{agents.length} agent{agents.length !== 1 ? 's' : ''} registered</span>
      </div>

      <div className="agents-page-grid">
        <section className="panel">
          <h2>Agent Status</h2>
          <AgentStatusPanel agents={agents} />
        </section>

        <section className="panel">
          <h2>Agent Control</h2>
          <AgentControlPanel
            send={send}
            connected={connected}
            agents={agents}
            sessionId={activeSessionId}
            onSessionChange={setActiveSessionId}
          />
        </section>
      </div>

      <div className="agents-detail-grid">
        {agents.map((agent) => (
          <div key={agent.id} className="panel agent-card">
            <div className="agent-card-header">
              <span className={`agent-busy-dot ${agent.busy ? 'busy' : 'idle'}`} />
              <strong>{agent.id}</strong>
              <span className="agent-role">{agent.role}</span>
            </div>
            {agent.currentTask && <p className="agent-task">Task: {agent.currentTask}</p>}
            <AgentActivitySparkline
              events={agentEvents(agent.id)}
              width={200}
              height={40}
            />
          </div>
        ))}
      </div>

      {agents.length > 0 && (
        <section className="panel">
          <h2>Role Distribution</h2>
          <RoleDistributionChart tasks={tasks} />
        </section>
      )}

      {agents.length === 0 && (
        <div className="page-empty">
          <p>No agents connected. Start the orchestrator to see agents here.</p>
        </div>
      )}
    </div>
  );
}
