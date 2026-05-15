import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { TaskInfo } from '../hooks/useWebSocket.js';
import { ROLE_COLORS } from '../lib/constants.js';

interface Props {
  tasks: TaskInfo[];
}

export function RoleDistributionChart({ tasks }: Props) {
  if (tasks.length === 0) {
    return <div className="empty-state">No task data</div>;
  }

  const byRole = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.role] = (acc[t.role] || 0) + 1;
    return acc;
  }, {});

  const data = Object.entries(byRole).map(([role, count]) => ({
    name: role,
    value: count,
    color: ROLE_COLORS[role] || '#888',
  }));

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={70}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.75rem',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="chart-legend">
        {data.map((d) => (
          <span key={d.name} className="legend-item">
            <span className="legend-dot" style={{ background: d.color }} />
            {d.name} ({d.value})
          </span>
        ))}
      </div>
    </div>
  );
}
