import type { AgentInfo, TaskInfo } from '../hooks/useWebSocket.js';
import { formatTokens } from '../lib/constants.js';

interface Props {
  agents: AgentInfo[];
  tasks: TaskInfo[];
  tokenTotal: number;
  chatTokenTotal: number;
  eventCount: number;
}

export function SummaryCards({ agents, tasks, tokenTotal, chatTokenTotal, eventCount }: Props) {
  const activeAgents = agents.filter((a) => a.busy).length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const failedTasks = tasks.filter((t) => t.status === 'failed').length;
  const runningTasks = tasks.filter((t) => t.status === 'running').length;
  const totalTokens = tokenTotal + chatTokenTotal;

  const cards = [
    { label: 'Active Agents', value: `${activeAgents}/${agents.length || '-'}`, sub: runningTasks > 0 ? `${runningTasks} running` : undefined, accent: activeAgents > 0 ? 'var(--accent-green)' : 'var(--text-secondary)' },
    { label: 'Tasks', value: `${completedTasks}/${tasks.length}`, accent: 'var(--accent-blue)' },
    { label: 'Tokens', value: formatTokens(totalTokens), accent: 'var(--accent-purple)' },
    { label: 'Failed', value: String(failedTasks), accent: failedTasks > 0 ? 'var(--accent-red)' : 'var(--text-secondary)' },
    { label: 'Events', value: String(eventCount), accent: 'var(--accent-teal)' },
  ];

  return (
    <div className="summary-cards">
      {cards.map((card) => (
        <div key={card.label} className="stat-card">
          <div className="stat-value" style={{ color: card.accent }}>{card.value}</div>
          <div className="stat-label">{card.label}</div>
          {card.sub && <div className="stat-sub">{card.sub}</div>}
        </div>
      ))}
    </div>
  );
}
