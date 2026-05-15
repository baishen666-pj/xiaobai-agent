import type { TaskInfo } from '../hooks/useWebSocket.js';

interface Props {
  tasks: TaskInfo[];
}

export function TaskFlowView({ tasks }: Props) {
  if (tasks.length === 0) {
    return <div className="empty-state">No tasks</div>;
  }

  return (
    <div className="task-list">
      {tasks.map((task) => (
        <div key={task.id} className={`task-item ${task.status}`}>
          <span className="task-status">{task.status}</span>
          <span className="task-desc">{task.description}</span>
          {task.completedAt && task.startedAt ? (
            <span className="task-duration">
              {((task.completedAt - task.startedAt) / 1000).toFixed(1)}s
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
