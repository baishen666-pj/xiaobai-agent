import { describe, it, expect, vi } from 'vitest';
import { generateTaskPlan, PlannedTaskSchema, TaskPlanSchema } from '../../src/core/planner.js';
import type { ProviderResponse } from '../../src/provider/types.js';
import type { Message } from '../../src/session/manager.js';
import { z } from 'zod';

describe('PlannedTaskSchema', () => {
  it('validates a valid task', () => {
    const task = {
      id: 'task_1',
      description: 'Read the auth module',
      role: 'researcher',
      priority: 'high',
      dependencies: [],
    };
    expect(PlannedTaskSchema.parse(task)).toEqual(task);
  });

  it('validates task with optional input', () => {
    const task = {
      id: 'task_2',
      description: 'Implement login',
      role: 'coder',
      priority: 'normal',
      dependencies: ['task_1'],
      input: { filePath: 'src/auth.ts' },
    };
    expect(PlannedTaskSchema.parse(task)).toEqual(task);
  });

  it('rejects invalid role', () => {
    const task = {
      id: 'task_1',
      description: 'Do something',
      role: 'invalid_role',
      priority: 'normal',
      dependencies: [],
    };
    expect(() => PlannedTaskSchema.parse(task)).toThrow();
  });

  it('rejects invalid priority', () => {
    const task = {
      id: 'task_1',
      description: 'Do something',
      role: 'coder',
      priority: 'urgent',
      dependencies: [],
    };
    expect(() => PlannedTaskSchema.parse(task)).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => PlannedTaskSchema.parse({})).toThrow();
  });
});

describe('TaskPlanSchema', () => {
  it('validates a complete plan', () => {
    const plan = {
      reasoning: 'Break into research and implementation phases',
      tasks: [
        { id: 'task_1', description: 'Research', role: 'researcher' as const, priority: 'high' as const, dependencies: [] },
        { id: 'task_2', description: 'Implement', role: 'coder' as const, priority: 'normal' as const, dependencies: ['task_1'] },
      ],
    };
    expect(TaskPlanSchema.parse(plan)).toEqual(plan);
  });

  it('rejects empty tasks array', () => {
    const plan = { reasoning: 'Simple', tasks: [] };
    expect(() => TaskPlanSchema.parse(plan)).toThrow();
  });

  it('rejects missing reasoning', () => {
    const plan = { tasks: [{ id: 't1', description: 'x', role: 'coder', priority: 'normal', dependencies: [] }] };
    expect(() => TaskPlanSchema.parse(plan)).toThrow();
  });
});

describe('generateTaskPlan', () => {
  const validPlanResponse = {
    reasoning: 'Decompose into research then coding',
    tasks: [
      { id: 'task_1', description: 'Investigate existing auth patterns', role: 'researcher', priority: 'high', dependencies: [] },
      { id: 'task_2', description: 'Implement JWT auth', role: 'coder', priority: 'normal', dependencies: ['task_1'] },
    ],
  };

  function createMockChatFn(response: any): (msgs: Message[], opts: any) => Promise<ProviderResponse> {
    return async () => ({
      content: JSON.stringify(response),
    });
  }

  it('generates a task plan from a goal', async () => {
    const plan = await generateTaskPlan(
      createMockChatFn(validPlanResponse),
      'Refactor the auth module to use JWT',
    );
    expect(plan.reasoning).toBe('Decompose into research then coding');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].role).toBe('researcher');
    expect(plan.tasks[1].dependencies).toEqual(['task_1']);
  });

  it('passes context to the LLM', async () => {
    const mockFn = vi.fn<() => Promise<ProviderResponse>>().mockResolvedValue({
      content: JSON.stringify({
        reasoning: 'Single task',
        tasks: [{ id: 'task_1', description: 'Do it', role: 'coder', priority: 'normal', dependencies: [] }],
      }),
    });

    await generateTaskPlan(mockFn, 'Implement feature X', 'The project uses TypeScript and Vitest');

    const calls = mockFn.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [messages] = calls[0];
    expect(messages[0].content).toContain('TypeScript and Vitest');
    expect(messages[0].content).toContain('Implement feature X');
  });

  it('retries on invalid JSON response', async () => {
    let callCount = 0;
    const mockFn = vi.fn<() => Promise<ProviderResponse>>().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return { content: 'This is not valid JSON for the schema' };
      }
      return { content: JSON.stringify(validPlanResponse) };
    });

    const plan = await generateTaskPlan(mockFn, 'Test goal');
    expect(plan.tasks).toHaveLength(2);
  });

  it('works with a single simple task', async () => {
    const plan = await generateTaskPlan(
      createMockChatFn({
        reasoning: 'Simple task',
        tasks: [{ id: 'task_1', description: 'Fix the typo', role: 'coder', priority: 'normal', dependencies: [] }],
      }),
      'Fix a typo in README',
    );
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].description).toBe('Fix the typo');
  });
});
