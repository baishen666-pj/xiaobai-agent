import { z } from 'zod';

export const WorkflowStepSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  role: z.enum(['coordinator', 'researcher', 'coder', 'reviewer', 'planner', 'tester']).optional(),
  prompt: z.string(),
  input: z.record(z.unknown()).optional(),
  dependsOn: z.array(z.string()).default([]),
  condition: z.string().optional(),
  parallel: z.boolean().default(false),
  onError: z.enum(['retry', 'fallback', 'skip', 'abort']).default('abort'),
  maxRetries: z.number().default(1),
  timeout: z.number().default(300000),
  fallbackPrompt: z.string().optional(),
  outputKey: z.string().optional(),
  tools: z.array(z.string()).optional(),
  maxTurns: z.number().optional(),
  subAgent: z.object({
    definitionName: z.string().optional(),
    maxTurns: z.number().optional(),
    allowedTools: z.array(z.string()).optional(),
  }).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});

export const WorkflowTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({ type: z.literal('file_change'), pattern: z.string() }),
  z.object({ type: z.literal('webhook'), path: z.string(), secret: z.string().optional() }),
  z.object({ type: z.literal('cron'), schedule: z.string() }),
]);

const ioschemaDef = z.object({
  type: z.string(),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
});

export const WorkflowDefinitionSchema = z.object({
  name: z.string(),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  inputs: z.record(ioschemaDef).optional(),
  outputs: z.record(ioschemaDef).optional(),
  variables: z.record(z.string()).optional(),
  steps: z.array(WorkflowStepSchema).min(1),
  triggers: z.array(WorkflowTriggerSchema).default([{ type: 'manual' }]),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface StepResult {
  stepId: string;
  status: 'completed' | 'failed' | 'skipped';
  output: string;
  tokensUsed: number;
  durationMs: number;
  error?: string;
  structuredOutput?: Record<string, unknown>;
}

export interface WorkflowRun {
  id: string;
  workflowName: string;
  status: WorkflowRunStatus;
  variables: Record<string, string>;
  stepResults: Map<string, StepResult>;
  startedAt: number;
  completedAt?: number;
  error?: string;
}
