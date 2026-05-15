import { useState } from 'react';
import type { TaskInfo } from '../hooks/useWebSocket.js';
import { TaskDependencyGraph } from './TaskDependencyGraph.js';
import { ListIcon, GraphIcon } from './Icons.js';

interface Props {
  tasks: TaskInfo[];
  progressEvents?: Record<string, string[]>;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--accent-red)',
  high: 'var(--accent-yellow)',
  normal: 'transparent',
  low: 'var(--text-secondary)',
};

export function TaskFlowView({ tasks, progressEvents }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');

  if (tasks.length === 0) {
    return <div className="empty-state">No tasks</div>;
  }

  const hasDeps = tasks.some((t) => (t.dependencies?.length ?? 0) > 0);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId);
  const selectedProgress = selectedTaskId ? progressEvents?.[selectedTaskId] ?? [] : [];

  return (
    <div className="task-flow-view">
      {hasDeps && (
        <div className="view-toggle">
          <button
            className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
            title="List view"
          >
            <ListIcon size={12} /> List
          </button>
          <button
            className={`view-btn ${viewMode === 'graph' ? 'active' : ''}`}
            onClick={() => setViewMode('graph')}
            title="Graph view"
          >
            <GraphIcon size={12} /> Graph
          </button>
        </div>
      )}

      {viewMode === 'graph' && hasDeps ? (
        <TaskDependencyGraph tasks={tasks} />
      ) : (
        <div className="task-list">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`task-item ${task.status} ${task.id === selectedTaskId ? 'selected' : ''}`}
              onClick={() => setSelectedTaskId(task.id === selectedTaskId ? null : task.id)}
            >
              {(task.priority && task.priority !== 'normal') && (
                <span
                  className="task-priority-dot"
                  style={{ background: PRIORITY_COLORS[task.priority] ?? 'transparent' }}
                  title={`Priority: ${task.priority}`}
                />
              )}
              <span className="task-status">{task.status}</span>
              <span className="task-desc">{task.description}</span>
              {task.status === 'running' && (
                <span className="task-running-indicator">●</span>
              )}
              {(task.retries ?? 0) > 0 && (
                <span className="task-retries" title={`Retries: ${task.retries}/${task.maxRetries}`}>
                  ↻{task.retries}
                </span>
              )}
              {task.completedAt && task.startedAt ? (
                <span className="task-duration">
                  {((task.completedAt - task.startedAt) / 1000).toFixed(1)}s
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {selectedTask && selectedProgress.length > 0 && (
        <div className="task-progress-panel">
          <div className="task-progress-header">
            Progress: {selectedTask.description.slice(0, 40)}
          </div>
          <div className="task-progress-list">
            {selectedProgress.map((msg, i) => (
              <div key={i} className="task-progress-line">{msg}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
