import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { TaskInfo } from '../hooks/useWebSocket.js';

const STATUS_COLORS: Record<string, string> = {
  pending: '#888',
  running: '#5b8def',
  completed: '#4caf7d',
  failed: '#d95555',
};

interface Props {
  tasks: TaskInfo[];
}

export function TaskTimelineChart({ tasks }: Props) {
  const timedTasks = tasks.filter((t) => t.startedAt);
  if (timedTasks.length === 0) {
    return <div className="empty-state">No timed tasks</div>;
  }

  const now = Date.now();
  const data = timedTasks.map((t) => {
    const end = t.completedAt ?? now;
    const start = t.startedAt ?? now;
    const duration = Math.max(0, (end - start) / 1000);
    return {
      name: t.description.slice(0, 20) + (t.description.length > 20 ? '…' : ''),
      duration: Math.round(duration * 10) / 10,
      status: t.status,
      fill: STATUS_COLORS[t.status] || '#888',
    };
  });

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <XAxis
            type="number"
            tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            unit="s"
          />
          <YAxis
            type="category"
            dataKey="name"
            width={100}
            tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.75rem',
            }}
            formatter={(value: number) => [`${value}s`, 'Duration']}
          />
          <Bar dataKey="duration" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <rect key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
