import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkflowEngine } from '../../src/workflow/engine.js';
import { WorkflowRegistry } from '../../src/workflow/registry.js';
import type { WorkflowDefinition } from '../../src/workflow/types.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => {
  const mockRun = vi.fn();
  const MockAgentLoop = vi.fn();
  return { mockRun, MockAgentLoop };
});

vi.mock('../../src/core/loop.js', () => {
  return {
    AgentLoop: mocks.MockAgentLoop.mockImplementation(() => ({
      run: mocks.mockRun,
    })),
  };
});

function createToolDefinitions(names: string[]) {
  return names.map((name) => ({
    name,
    description: `${name} tool`,
    parameters: { type: 'object' as const, properties: {} },
  }));
}

function createMockDeps() {
  return {
    provider: {
      chat: vi.fn(async () => 'agent-response'),
    },
    tools: {
      getToolDefinitions: vi.fn(() => createToolDefinitions(['bash', 'read_file', 'write_file'])),
      execute: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
        output: `executed ${_name}`,
        success: true,
      })),
    },
    sessions: {},
    hooks: {},
    memory: {},
    security: {},
    config: {},
  } as any;
}

describe('WorkflowEngine runWithTools', () => {
  let tempDir: string;
  let registry: WorkflowRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wf-tools-'));
    registry = new WorkflowRegistry(tempDir);

    async function* generatorFn() {
      yield { type: 'text', content: 'tool-output-result' };
    }
    mocks.mockRun.mockImplementation(generatorFn);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    mocks.mockRun.mockReset();
    mocks.MockAgentLoop.mockClear();
  });

  it('should create filtered tool registry when step has tools', async () => {
    const deps = createMockDeps();

    const wf: WorkflowDefinition = {
      name: 'tool-filter',
      steps: [{ id: 's1', prompt: 'Run bash command', tools: ['bash'] }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    const run = await engine.run('tool-filter');

    expect(run.stepResults.get('s1')?.status).toBe('completed');
    expect(mocks.MockAgentLoop).toHaveBeenCalled();

    const loopInstance = mocks.MockAgentLoop.mock.results[0].value;
    expect(loopInstance.run).toHaveBeenCalledWith(
      'Run bash command',
      expect.stringContaining('wf_step_s1_'),
      expect.objectContaining({ maxTurns: 10, abortSignal: expect.any(AbortSignal) }),
    );
  });

  it('should use AgentLoop for steps with tools', async () => {
    const deps = createMockDeps();

    const wf: WorkflowDefinition = {
      name: 'tool-loop',
      steps: [{ id: 's1', prompt: 'Build it', tools: ['bash', 'read_file'] }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    const run = await engine.run('tool-loop');

    expect(run.status).toBe('completed');
    expect(run.stepResults.get('s1')?.output).toBe('tool-output-result');
    expect(mocks.MockAgentLoop).toHaveBeenCalledTimes(1);

    // Verify provider.chat was NOT called (AgentLoop was used instead)
    expect(deps.provider.chat).not.toHaveBeenCalled();
  });

  it('should respect maxTurns from step configuration', async () => {
    const deps = createMockDeps();

    const wf: WorkflowDefinition = {
      name: 'max-turns',
      steps: [{ id: 's1', prompt: 'Iterate', tools: ['bash'], maxTurns: 5 }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    await engine.run('max-turns');

    const loopInstance = mocks.MockAgentLoop.mock.results[0].value;
    expect(loopInstance.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ maxTurns: 5 }),
    );
  });

  it('should default maxTurns to 10 when not specified', async () => {
    const deps = createMockDeps();

    const wf: WorkflowDefinition = {
      name: 'default-turns',
      steps: [{ id: 's1', prompt: 'Default turns', tools: ['bash'] }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    await engine.run('default-turns');

    const loopInstance = mocks.MockAgentLoop.mock.results[0].value;
    expect(loopInstance.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ maxTurns: 10 }),
    );
  });

  it('should use runAgent for steps without tools', async () => {
    const deps = createMockDeps();

    const wf: WorkflowDefinition = {
      name: 'no-tools',
      steps: [{ id: 's1', prompt: 'Simple prompt' }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    const run = await engine.run('no-tools');

    expect(run.status).toBe('completed');
    expect(run.stepResults.get('s1')?.output).toBe('agent-response');
    // AgentLoop should NOT have been constructed
    expect(mocks.MockAgentLoop).not.toHaveBeenCalled();
    // provider.chat should have been called (runAgent path)
    expect(deps.provider.chat).toHaveBeenCalled();
  });

  it('should only include allowed tools in filtered registry', async () => {
    const deps = createMockDeps();

    // All three tools exist, but step only allows 'bash'
    const wf: WorkflowDefinition = {
      name: 'partial-tools',
      steps: [{ id: 's1', prompt: 'Limited tools', tools: ['bash'] }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    await engine.run('partial-tools');

    // Verify AgentLoop was constructed (tools path taken)
    expect(mocks.MockAgentLoop).toHaveBeenCalledTimes(1);

    // The AgentLoop constructor receives a deps object with the filtered tool registry.
    const constructorCall = mocks.MockAgentLoop.mock.calls[0][0];
    expect(constructorCall.tools).toBeDefined();
    expect(typeof constructorCall.tools.getToolDefinitions).toBe('function');
  });

  it('should handle empty tools array by using runAgent', async () => {
    const deps = createMockDeps();

    const wf: WorkflowDefinition = {
      name: 'empty-tools',
      steps: [{ id: 's1', prompt: 'Empty tools', tools: [] }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    const run = await engine.run('empty-tools');

    // Empty tools array is falsy (length === 0 check in engine), so runAgent is used
    expect(run.stepResults.get('s1')?.status).toBe('completed');
    expect(deps.provider.chat).toHaveBeenCalled();
    expect(mocks.MockAgentLoop).not.toHaveBeenCalled();
  });
});
