import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { TokenHistoryEntry } from '../hooks/useWebSocket.js';

const ROLE_COLORS: Record<string, string> = {
  researcher: '#5b8def',
  coder: '#4caf7d',
  reviewer: '#9c6bca',
  planner: '#d4a843',
  tester: '#d95555',
  coordinator: '#3bb5a0',
};

interface Props {
  tokenHistory: TokenHistoryEntry[];
}

export function TokenTimelineChart({ tokenHistory }: Props) {
  if (tokenHistory.length < 2) {
    return <div className="empty-state">Need more data points</div>;
  }

  const cumulative = tokenHistory.reduce<{ points: { time: string; tokens: number; role: string }[]; total: number }>(
    (acc, entry, i) => {
      acc.total += entry.tokens;
      acc.points.push({
        time: new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        tokens: acc.total,
        role: entry.role,
      });
      return acc;
    },
    { points: [], total: 0 },
  );

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={cumulative.points} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
          />
          <YAxis
            tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={50}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.75rem',
            }}
            labelStyle={{ color: 'var(--text-secondary)' }}
          />
          <Area
            type="monotone"
            dataKey="tokens"
            stroke="var(--accent-blue)"
            fill="url(#tokenGradient)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
