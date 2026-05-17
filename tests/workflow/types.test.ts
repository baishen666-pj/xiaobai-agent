import { describe, it, expect } from 'vitest';
import { WorkflowDefinitionSchema, WorkflowStepSchema, WorkflowTriggerSchema } from '../../src/workflow/types.js';

describe('WorkflowStepSchema', () => {
  it('should parse a minimal step', () => {
    const step = WorkflowStepSchema.parse({ id: 's1', prompt: 'Do something' });
    expect(step.id).toBe('s1');
    expect(step.prompt).toBe('Do something');
    expect(step.dependsOn).toEqual([]);
    expect(step.parallel).toBe(false);
    expect(step.onError).toBe('abort');
    expect(step.maxRetries).toBe(1);
    expect(step.timeout).toBe(300000);
  });

  it('should parse a full step', () => {
    const step = WorkflowStepSchema.parse({
      id: 's2',
      name: 'Analyze',
      role: 'researcher',
      prompt: 'Analyze {{target}}',
      dependsOn: ['s1'],
      condition: 'variables.runAnalysis === true',
      parallel: true,
      onError: 'retry',
      maxRetries: 3,
      timeout: 60000,
      fallbackPrompt: 'Simplified analysis',
      outputKey: 'analysis',
    });
    expect(step.role).toBe('researcher');
    expect(step.onError).toBe('retry');
    expect(step.fallbackPrompt).toBe('Simplified analysis');
  });

  it('should reject invalid role', () => {
    expect(() => WorkflowStepSchema.parse({
      id: 's1', prompt: 'test', role: 'invalid',
    })).toThrow();
  });

  it('should reject invalid onError', () => {
    expect(() => WorkflowStepSchema.parse({
      id: 's1', prompt: 'test', onError: 'explode',
    })).toThrow();
  });
});

describe('WorkflowTriggerSchema', () => {
  it('should parse manual trigger', () => {
    const trigger = WorkflowTriggerSchema.parse({ type: 'manual' });
    expect(trigger.type).toBe('manual');
  });

  it('should parse file_change trigger', () => {
    const trigger = WorkflowTriggerSchema.parse({ type: 'file_change', pattern: '/src/**/*.ts' });
    expect(trigger.type).toBe('file_change');
    if (trigger.type === 'file_change') expect(trigger.pattern).toBe('/src/**/*.ts');
  });

  it('should parse webhook trigger', () => {
    const trigger = WorkflowTriggerSchema.parse({ type: 'webhook', path: '/hook/test', secret: 'abc' });
    expect(trigger.type).toBe('webhook');
    if (trigger.type === 'webhook') expect(trigger.path).toBe('/hook/test');
  });

  it('should parse cron trigger', () => {
    const trigger = WorkflowTriggerSchema.parse({ type: 'cron', schedule: '*/5 * * * *' });
    expect(trigger.type).toBe('cron');
    if (trigger.type === 'cron') expect(trigger.schedule).toBe('*/5 * * * *');
  });

  it('should reject unknown trigger type', () => {
    expect(() => WorkflowTriggerSchema.parse({ type: 'email' })).toThrow();
  });
});

describe('WorkflowDefinitionSchema', () => {
  it('should parse a minimal definition', () => {
    const def = WorkflowDefinitionSchema.parse({
      name: 'test-workflow',
      steps: [{ id: 's1', prompt: 'Hello' }],
    });
    expect(def.name).toBe('test-workflow');
    expect(def.version).toBe('1.0.0');
    expect(def.tags).toEqual([]);
    expect(def.triggers).toEqual([{ type: 'manual' }]);
  });

  it('should parse a full definition', () => {
    const def = WorkflowDefinitionSchema.parse({
      name: 'full-workflow',
      version: '2.0.0',
      description: 'A test workflow',
      author: 'test',
      tags: ['test', 'ci'],
      variables: { target: 'src/' },
      steps: [
        { id: 'analyze', prompt: 'Analyze {{target}}', role: 'researcher' },
        { id: 'fix', prompt: 'Fix issues', dependsOn: ['analyze'], role: 'coder' },
      ],
      triggers: [{ type: 'manual' }, { type: 'cron', schedule: '0 * * * *' }],
    });
    expect(def.steps).toHaveLength(2);
    expect(def.triggers).toHaveLength(2);
    expect(def.variables).toEqual({ target: 'src/' });
  });

  it('should reject empty steps', () => {
    expect(() => WorkflowDefinitionSchema.parse({
      name: 'empty',
      steps: [],
    })).toThrow();
  });
});
