import { useState } from 'react';
import { TokenTimelineChart } from './TokenTimelineChart.js';
import { RoleDistributionChart } from './RoleDistributionChart.js';
import { TaskTimelineChart } from './TaskTimelineChart.js';
import type { TaskInfo, TokenHistoryEntry } from '../hooks/useWebSocket.js';

type Tab = 'timeline' | 'roles' | 'tasks';

const TABS: { key: Tab; label: string }[] = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'roles', label: 'Roles' },
  { key: 'tasks', label: 'Tasks' },
];

interface Props {
  tokenHistory: TokenHistoryEntry[];
  tasks: TaskInfo[];
}

export function ChartPanel({ tokenHistory, tasks }: Props) {
  const [tab, setTab] = useState<Tab>('timeline');

  return (
    <div className="chart-panel">
      <div className="chart-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`chart-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="chart-content">
        {tab === 'timeline' && <TokenTimelineChart tokenHistory={tokenHistory} />}
        {tab === 'roles' && <RoleDistributionChart tasks={tasks} />}
        {tab === 'tasks' && <TaskTimelineChart tasks={tasks} />}
      </div>
    </div>
  );
}
