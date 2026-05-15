import { useMemo } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import type { LogEvent } from '../hooks/useWebSocket.js';

interface Props {
  agentId: string;
  events: LogEvent[];
  windowMs?: number;
}

export function AgentActivitySparkline({ agentId, events, windowMs = 60_000 }: Props) {
  const points = useMemo(() => {
    const now = Date.now();
    const cutoff = now - windowMs;
    const buckets = 20;
    const bucketSize = windowMs / buckets;
    const pts = Array.from({ length: buckets }, (_, i) => ({
      count: 0,
      t: cutoff + i * bucketSize,
    }));

    for (const e of events) {
      if (e.timestamp < cutoff) continue;
      if (e.message && e.message.includes(agentId)) {
        const idx = Math.min(Math.floor((e.timestamp - cutoff) / bucketSize), buckets - 1);
        if (idx >= 0) pts[idx].count++;
      }
    }
    return pts;
  }, [events, agentId, windowMs]);

  return (
    <div className="sparkline-container">
      <ResponsiveContainer width="100%" height={24}>
        <LineChart data={points}>
          <Line
            type="monotone"
            dataKey="count"
            stroke="var(--accent-teal)"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
