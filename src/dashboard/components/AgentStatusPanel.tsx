import type { AgentInfo } from '../hooks/useWebSocket.js';

interface Props {
  agents: AgentInfo[];
}

export function AgentStatusPanel({ agents }: Props) {
  if (agents.length === 0) {
    return <div className="empty-state">No agents active</div>;
  }

  return (
    <div className="agent-list">
      {agents.map((agent) => (
        <div key={agent.id} className="agent-card">
          <div className={`agent-dot ${agent.busy ? 'busy' : 'idle'}`} />
          <div className="agent-info">
            <div className="agent-name">{agent.id.split('_').pop()}</div>
            <div className="agent-role">{agent.role}</div>
          </div>
          <span className={`task-status`}>
            {agent.busy ? 'WORKING' : 'IDLE'}
          </span>
        </div>
      ))}
    </div>
  );
}
