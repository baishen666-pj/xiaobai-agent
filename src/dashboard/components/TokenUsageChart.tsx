import type { TaskInfo } from '../hooks/useWebSocket.js';
import { ROLE_COLORS, formatTokens } from '../lib/constants.js';

interface Props {
  total: number;
  tasks: TaskInfo[];
}

export function TokenUsageChart({ total, tasks }: Props) {
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
