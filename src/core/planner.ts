import { z } from 'zod';
import { structuredChat } from '../structured/index.js';
import type { Message } from '../session/manager.js';
import type { ChatOptions, ProviderResponse } from '../provider/types.js';
import type { RoleId } from './roles.js';

export const PlannedTaskSchema = z.object({
  id: z.string().describe('Unique task identifier (e.g. "task_1", "task_2")'),
  description: z.string().describe('Clear, actionable description of what needs to be done'),
  role: z.enum(['coordinator', 'researcher', 'coder', 'reviewer', 'planner', 'tester']).describe('Best agent role for this task'),
  priority: z.enum(['critical', 'high', 'normal', 'low']).describe('Task priority'),
  dependencies: z.array(z.string()).describe('IDs of tasks that must complete before this one'),
  input: z.record(z.unknown()).optional().describe('Additional input data for the task'),
});

export const TaskPlanSchema = z.object({
  reasoning: z.string().describe('Brief analysis of the request and decomposition strategy'),
  tasks: z.array(PlannedTaskSchema).min(1).describe('Ordered list of tasks to execute'),
});

export type PlannedTask = z.infer<typeof PlannedTaskSchema>;
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

const PLAN_SYSTEM_PROMPT = `You are a task planning engine. Analyze the user's request and decompose it into a DAG of tasks.

Rules:
- Each task must have a unique ID (task_1, task_2, ...)
- Tasks that can run in parallel should have no dependency between them
- Assign the most appropriate role to each task
- Order tasks so dependencies come before dependents
- Keep each task focused on a single responsibility
- Include a "reasoning" field explaining your decomposition strategy
- If the request is simple, a single task is fine
- For complex requests, aim for 3-7 tasks`;

export async function generateTaskPlan(
  chatFn: (messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>,
  goal: string,
  context?: string,
): Promise<TaskPlan> {
  const messages: Message[] = [];

  if (context) {
    messages.push({
      role: 'user',
      content: `Context:\n${context}\n\nGoal: ${goal}`,
    });
  } else {
    messages.push({ role: 'user', content: goal });
  }

  const result = await structuredChat<TaskPlan>(chatFn, messages, {
    schema: TaskPlanSchema,
    name: 'task_plan',
    description: 'Decompose a goal into a structured task plan',
    maxRetries: 2,
  });

  return result.data;
}
