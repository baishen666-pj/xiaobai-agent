import { z } from 'zod';
import { structuredChat } from '../structured/index.js';
import type { Message } from '../session/manager.js';
import type { ChatOptions, ProviderResponse } from '../provider/types.js';
import type { RoleId } from './roles.js';

export const ReflectionOutcomeSchema = z.object({
  analysis: z.string().describe('Root cause analysis of the failure'),
  strategy: z.enum(['retry_same', 'retry_different_role', 'retry_simplified', 'give_up']).describe('Recommended strategy'),
  suggestedRole: z.enum(['coordinator', 'researcher', 'coder', 'reviewer', 'planner', 'tester']).optional().describe('New role if strategy is retry_different_role'),
  revisedDescription: z.string().optional().describe('Simplified task description if strategy is retry_simplified'),
  adjustments: z.array(z.string()).describe('Specific adjustments to make'),
});

export type ReflectionOutcome = z.infer<typeof ReflectionOutcomeSchema>;

const REFLECTION_SYSTEM_PROMPT = `You are a failure analysis engine for an AI agent orchestrator.

Analyze the failed task and determine the best recovery strategy:
- retry_same: Try again with the same approach (transient errors)
- retry_different_role: Assign to a different specialist role
- retry_simplified: Break into simpler sub-tasks
- give_up: The task is fundamentally infeasible

Be pragmatic. Only suggest give_up when truly hopeless.`;

export async function analyzeFailure(
  chatFn: (messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>,
  taskDescription: string,
  errorMessage: string,
  output: string,
): Promise<ReflectionOutcome> {
  const messages: Message[] = [
    {
      role: 'user',
      content: `## Failed Task\nDescription: ${taskDescription}\n\n## Error\n${errorMessage}\n\n## Partial Output\n${output.slice(0, 2000)}`,
    },
  ];

  const result = await structuredChat<ReflectionOutcome>(chatFn, messages, {
    schema: ReflectionOutcomeSchema,
    name: 'reflection_outcome',
    description: 'Analyze a failed task and recommend recovery strategy',
    maxRetries: 1,
  });

  return result.data;
}
