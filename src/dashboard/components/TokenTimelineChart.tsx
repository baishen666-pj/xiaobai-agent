import { useMemo } from 'react';
import { useId } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { TokenHistoryEntry } from '../hooks/useWebSocket.js';

interface Props {
  tokenHistory: TokenHistoryEntry[];
}

export function TokenTimelineChart({ tokenHistory }: Props) {
  const gradientId = useId();

  const cumulative = useMemo(() => {
    let total = 0;
    return tokenHistory.map((entry) => {
      total += entry.tokens;
      return {
        time: new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        tokens: total,
        role: entry.role,
      };
    });
  }, [tokenHistory]);

  if (cumulative.length < 2) {
    return <div className="empty-state">Need more data points</div>;
  }

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={cumulative} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id={`tokenGrad-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
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
            fill={`url(#tokenGrad-${gradientId})`}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
