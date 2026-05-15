import type { RoleId } from './roles.js';

export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface Task {
  id: string;
  parentTaskId?: string;
  description: string;
  role: RoleId;
  status: TaskStatus;
  priority: TaskPriority;
  dependencies: string[];
  input: Record<string, unknown>;
  result?: TaskResult;
  assignedAgentId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retries: number;
  maxRetries: number;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  output: string;
  artifacts: TaskArtifact[];
  tokensUsed: number;
  durationMs: number;
  error?: string;
}

export interface TaskArtifact {
  type: 'file' | 'code' | 'analysis' | 'plan' | 'test_result';
  name: string;
  path?: string;
  content: string;
}

export interface TaskEvent {
  type: 'created' | 'assigned' | 'started' | 'progress' | 'completed' | 'failed' | 'cancelled';
  taskId: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

let taskCounter = 0;

export function createTask(params: {
  description: string;
  role: RoleId;
  input?: Record<string, unknown>;
  priority?: TaskPriority;
  dependencies?: string[];
  parentTaskId?: string;
  maxRetries?: number;
}): Task {
  return {
    id: `task_${++taskCounter}_${Date.now().toString(36)}`,
    parentTaskId: params.parentTaskId,
    description: params.description,
    role: params.role,
    status: 'pending',
    priority: params.priority ?? 'normal',
    dependencies: params.dependencies ?? [],
    input: params.input ?? {},
    createdAt: Date.now(),
    retries: 0,
    maxRetries: params.maxRetries ?? 1,
  };
}

export function isTaskReady(task: Task, completedIds: Set<string>): boolean {
  if (task.status !== 'pending') return false;
  if (task.dependencies.length === 0) return true;
  return task.dependencies.every((depId) => completedIds.has(depId));
}

export function sortTasksByPriority(tasks: Task[]): Task[] {
  const priorityOrder: Record<TaskPriority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  return [...tasks].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );
}

export function getSubtasks(parentId: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.parentTaskId === parentId);
}

export function areAllSubtasksCompleted(parentId: string, tasks: Task[]): boolean {
  const subs = getSubtasks(parentId, tasks);
  if (subs.length === 0) return false;
  return subs.every((t) => t.status === 'completed' || t.status === 'failed');
}
