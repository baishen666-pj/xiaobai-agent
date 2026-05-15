import { describe, it, expect } from 'vitest';
import {
  createTask,
  isTaskReady,
  sortTasksByPriority,
  getSubtasks,
  areAllSubtasksCompleted,
  type Task,
} from '../src/core/task.js';

describe('task', () => {
  describe('createTask', () => {
    it('creates task with defaults', () => {
      const task = createTask({
        description: 'Search codebase',
        role: 'researcher',
      });

      expect(task.id).toMatch(/^task_\d+_/);
      expect(task.description).toBe('Search codebase');
      expect(task.role).toBe('researcher');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('normal');
      expect(task.dependencies).toEqual([]);
      expect(task.input).toEqual({});
      expect(task.retries).toBe(0);
      expect(task.maxRetries).toBe(1);
      expect(task.createdAt).toBeGreaterThan(0);
    });

    it('creates task with all options', () => {
      const task = createTask({
        description: 'Fix bug',
        role: 'coder',
        priority: 'high',
        dependencies: ['task_1'],
        input: { file: 'src/app.ts' },
        parentTaskId: 'parent_1',
        maxRetries: 3,
      });

      expect(task.priority).toBe('high');
      expect(task.dependencies).toEqual(['task_1']);
      expect(task.input).toEqual({ file: 'src/app.ts' });
      expect(task.parentTaskId).toBe('parent_1');
      expect(task.maxRetries).toBe(3);
    });

    it('generates unique IDs', () => {
      const task1 = createTask({ description: 'A', role: 'coder' });
      const task2 = createTask({ description: 'B', role: 'coder' });
      expect(task1.id).not.toBe(task2.id);
    });
  });

  describe('isTaskReady', () => {
    it('pending task with no deps is ready', () => {
      const task = createTask({ description: 'T', role: 'coder' });
      expect(isTaskReady(task, new Set())).toBe(true);
    });

    it('pending task with met deps is ready', () => {
      const task = createTask({
        description: 'T',
        role: 'coder',
        dependencies: ['dep_1', 'dep_2'],
      });
      expect(isTaskReady(task, new Set(['dep_1', 'dep_2']))).toBe(true);
    });

    it('pending task with unmet deps is not ready', () => {
      const task = createTask({
        description: 'T',
        role: 'coder',
        dependencies: ['dep_1'],
      });
      expect(isTaskReady(task, new Set())).toBe(false);
    });

    it('non-pending task is never ready', () => {
      const task = createTask({ description: 'T', role: 'coder' });
      task.status = 'running';
      expect(isTaskReady(task, new Set())).toBe(false);
    });
  });

  describe('sortTasksByPriority', () => {
    it('sorts by priority descending', () => {
      const low = createTask({ description: 'low', role: 'coder', priority: 'low' });
      const critical = createTask({ description: 'crit', role: 'coder', priority: 'critical' });
      const normal = createTask({ description: 'norm', role: 'coder', priority: 'normal' });
      const high = createTask({ description: 'high', role: 'coder', priority: 'high' });

      const sorted = sortTasksByPriority([low, critical, normal, high]);
      expect(sorted.map((t) => t.priority)).toEqual([
        'critical',
        'high',
        'normal',
        'low',
      ]);
    });

    it('does not mutate original array', () => {
      const tasks = [
        createTask({ description: 'low', role: 'coder', priority: 'low' }),
        createTask({ description: 'high', role: 'coder', priority: 'high' }),
      ];
      const sorted = sortTasksByPriority(tasks);
      expect(tasks[0].priority).toBe('low');
      expect(sorted[0].priority).toBe('high');
    });
  });

  describe('getSubtasks', () => {
    it('finds child tasks', () => {
      const parent = createTask({ description: 'parent', role: 'coordinator' });
      const child1 = createTask({ description: 'c1', role: 'coder', parentTaskId: parent.id });
      const child2 = createTask({ description: 'c2', role: 'reviewer', parentTaskId: parent.id });
      const other = createTask({ description: 'other', role: 'researcher' });

      const subs = getSubtasks(parent.id, [parent, child1, child2, other]);
      expect(subs).toHaveLength(2);
      expect(subs.map((t) => t.role)).toEqual(['coder', 'reviewer']);
    });

    it('returns empty for no children', () => {
      const task = createTask({ description: 't', role: 'coder' });
      expect(getSubtasks(task.id, [task])).toEqual([]);
    });
  });

  describe('areAllSubtasksCompleted', () => {
    it('returns false when no subtasks', () => {
      const parent = createTask({ description: 'p', role: 'coordinator' });
      expect(areAllSubtasksCompleted(parent.id, [parent])).toBe(false);
    });

    it('returns true when all subtasks completed', () => {
      const parent = createTask({ description: 'p', role: 'coordinator' });
      const child1 = createTask({ description: 'c1', role: 'coder', parentTaskId: parent.id });
      const child2 = createTask({ description: 'c2', role: 'reviewer', parentTaskId: parent.id });
      child1.status = 'completed';
      child2.status = 'completed';

      expect(areAllSubtasksCompleted(parent.id, [parent, child1, child2])).toBe(true);
    });

    it('returns true when subtasks completed or failed', () => {
      const parent = createTask({ description: 'p', role: 'coordinator' });
      const child1 = createTask({ description: 'c1', role: 'coder', parentTaskId: parent.id });
      const child2 = createTask({ description: 'c2', role: 'reviewer', parentTaskId: parent.id });
      child1.status = 'completed';
      child2.status = 'failed';

      expect(areAllSubtasksCompleted(parent.id, [parent, child1, child2])).toBe(true);
    });

    it('returns false when some subtasks still running', () => {
      const parent = createTask({ description: 'p', role: 'coordinator' });
      const child1 = createTask({ description: 'c1', role: 'coder', parentTaskId: parent.id });
      const child2 = createTask({ description: 'c2', role: 'reviewer', parentTaskId: parent.id });
      child1.status = 'completed';
      child2.status = 'running';

      expect(areAllSubtasksCompleted(parent.id, [parent, child1, child2])).toBe(false);
    });
  });
});
