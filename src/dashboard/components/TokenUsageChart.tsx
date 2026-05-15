import type { TaskInfo, TokenHistoryEntry } from '../hooks/useWebSocket.js';

interface Props {
  total: number;
  tasks: TaskInfo[];
  tokenHistory?: TokenHistoryEntry[];
}

const ROLE_COLORS: Record<string, string> = {
  researcher: 'var(--accent-blue)',
  coder: 'var(--accent-green)',
  reviewer: 'var(--accent-purple)',
  planner: 'var(--accent-yellow)',
  tester: 'var(--accent-red)',
  coordinator: 'oklch(55% 0.15 200)',
};

export function TokenUsageChart({ total, tasks: _tasks }: Props) {
  const tasks = _tasks;
  const completedTasks = tasks.filter((t) => t.status === 'completed' && (t.tokensUsed ?? 0) > 0);
  const maxTokens = Math.max(...completedTasks.map((t) => t.tokensUsed ?? 0), 1);

  return (
    <div className="token-display">
      <div className="token-total">{formatTokens(total)}</div>
      <div className="token-breakdown">
        {completedTasks.map((task) => (
          <div key={task.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                {task.role}
              </span>
              <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                {formatTokens(task.tokensUsed ?? 0)}
              </span>
            </div>
            <div className="token-bar-track">
              <div
                className="token-bar-fill"
                style={{
                  width: `${((task.tokensUsed ?? 0) / maxTokens) * 100}%`,
                  background: ROLE_COLORS[task.role] ?? 'var(--accent-blue)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
