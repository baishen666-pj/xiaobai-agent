import { describe, it, expect } from 'vitest';
import { WorkflowStepSchema, WorkflowDefinitionSchema } from '../../src/workflow/types.js';
import type { StepResult } from '../../src/workflow/types.js';

describe('WorkflowStepSchema extended fields', () => {
  it('should parse a minimal step without new fields', () => {
    const step = WorkflowStepSchema.parse({ id: 's1', prompt: 'Do something' });
    expect(step.id).toBe('s1');
    expect(step.prompt).toBe('Do something');
    expect(step.tools).toBeUndefined();
    expect(step.maxTurns).toBeUndefined();
    expect(step.subAgent).toBeUndefined();
    expect(step.outputSchema).toBeUndefined();
  });

  it('should parse a step with tools field', () => {
    const step = WorkflowStepSchema.parse({
      id: 's1',
      prompt: 'Run commands',
      tools: ['bash', 'read_file'],
    });
    expect(step.tools).toEqual(['bash', 'read_file']);
  });

  it('should parse a step with subAgent field', () => {
    const step = WorkflowStepSchema.parse({
      id: 's1',
      prompt: 'Delegate work',
      subAgent: {
        definitionName: 'research-agent',
        maxTurns: 5,
        allowedTools: ['search', 'read_file'],
      },
    });
    expect(step.subAgent).toBeDefined();
    expect(step.subAgent!.definitionName).toBe('research-agent');
    expect(step.subAgent!.maxTurns).toBe(5);
    expect(step.subAgent!.allowedTools).toEqual(['search', 'read_file']);
  });

  it('should parse a step with outputSchema field', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, count: { type: 'number' } },
    };
    const step = WorkflowStepSchema.parse({
      id: 's1',
      prompt: 'Extract data',
      outputSchema: schema,
    });
    expect(step.outputSchema).toEqual(schema);
  });

  it('should parse a step with all new fields', () => {
    const step = WorkflowStepSchema.parse({
      id: 's1',
      name: 'Full step',
      prompt: 'Do everything',
      tools: ['bash'],
      maxTurns: 8,
      subAgent: {
        definitionName: 'worker',
        maxTurns: 3,
        allowedTools: ['search'],
      },
      outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
    });
    expect(step.tools).toEqual(['bash']);
    expect(step.maxTurns).toBe(8);
    expect(step.subAgent!.definitionName).toBe('worker');
    expect(step.outputSchema).toBeDefined();
  });

  it('should reject invalid tools field (non-string array)', () => {
    expect(() =>
      WorkflowStepSchema.parse({ id: 's1', prompt: 'test', tools: [123] }),
    ).toThrow();
  });

  it('should reject invalid subAgent field (missing required shape)', () => {
    expect(() =>
      WorkflowStepSchema.parse({ id: 's1', prompt: 'test', subAgent: 'bad' }),
    ).toThrow();
  });
});

describe('StepResult structuredOutput', () => {
  it('should accept StepResult with structuredOutput', () => {
    const result: StepResult = {
      stepId: 's1',
      status: 'completed',
      output: '{"name":"test"}',
      tokensUsed: 50,
      durationMs: 200,
      structuredOutput: { name: 'test' },
    };
    expect(result.structuredOutput).toEqual({ name: 'test' });
  });

  it('should accept StepResult without structuredOutput', () => {
    const result: StepResult = {
      stepId: 's2',
      status: 'completed',
      output: 'plain text',
      tokensUsed: 10,
      durationMs: 100,
    };
    expect(result.structuredOutput).toBeUndefined();
  });

  it('should accept StepResult with empty structuredOutput', () => {
    const result: StepResult = {
      stepId: 's3',
      status: 'completed',
      output: '{}',
      tokensUsed: 0,
      durationMs: 50,
      structuredOutput: {},
    };
    expect(result.structuredOutput).toEqual({});
  });
});

describe('WorkflowDefinitionSchema with extended steps', () => {
  it('should parse a workflow with tool-using steps', () => {
    const def = WorkflowDefinitionSchema.parse({
      name: 'tool-workflow',
      steps: [
        { id: 's1', prompt: 'Build project', tools: ['bash', 'read_file'], maxTurns: 15 },
      ],
    });
    expect(def.steps[0].tools).toEqual(['bash', 'read_file']);
    expect(def.steps[0].maxTurns).toBe(15);
  });

  it('should parse a workflow with subAgent steps', () => {
    const def = WorkflowDefinitionSchema.parse({
      name: 'subagent-workflow',
      steps: [
        {
          id: 's1',
          prompt: 'Research topic',
          subAgent: { definitionName: 'researcher', maxTurns: 10, allowedTools: ['search'] },
        },
      ],
    });
    expect(def.steps[0].subAgent!.definitionName).toBe('researcher');
  });

  it('should parse a workflow with outputSchema steps', () => {
    const schema = { type: 'object', properties: { items: { type: 'array' } } };
    const def = WorkflowDefinitionSchema.parse({
      name: 'structured-workflow',
      steps: [
        { id: 's1', prompt: 'Extract list', outputSchema: schema },
      ],
    });
    expect(def.steps[0].outputSchema).toEqual(schema);
  });
});
