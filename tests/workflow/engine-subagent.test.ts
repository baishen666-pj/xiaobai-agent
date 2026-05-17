import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkflowEngine } from '../../src/workflow/engine.js';
import { WorkflowRegistry } from '../../src/workflow/registry.js';
import type { WorkflowDefinition } from '../../src/workflow/types.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => {
  const mockSpawn = vi.fn();
  const MockSubAgentEngine = vi.fn();
  return { mockSpawn, MockSubAgentEngine };
});

vi.mock('../../src/core/sub-agent.js', () => {
  return {
    SubAgentEngine: mocks.MockSubAgentEngine.mockImplementation(() => ({
      spawn: mocks.mockSpawn,
    })),
  };
});

function createMockDeps() {
  return {
    provider: {
      chat: vi.fn(async () => 'agent-response'),
    },
    tools: {
      getToolDefinitions: vi.fn(() => []),
      execute: vi.fn(async () => ({ output: 'ok', success: true })),
    },
    sessions: {},
    hooks: {},
    memory: {},
    security: {},
    config: {},
  } as any;
}

describe('WorkflowEngine runSubAgent', () => {
  let tempDir: string;
  let registry: WorkflowRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wf-subagent-'));
    registry = new WorkflowRegistry(tempDir);
    mocks.mockSpawn.mockReset();
    mocks.MockSubAgentEngine.mockClear();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should call SubAgentEngine.spawn when step has subAgent', async () => {
    mocks.mockSpawn.mockResolvedValue({
      output: 'research complete',
      success: true,
      tokensUsed: 120,
      toolCalls: 3,
    });

    const deps = createMockDeps();
    const wf: WorkflowDefinition = {
      name: 'subagent-test',
      steps: [{
        id: 's1',
        prompt: 'Research topic X',
        subAgent: {
          definitionName: 'researcher',
          maxTurns: 8,
          allowedTools: ['search', 'read_file'],
        },
      }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    const run = await engine.run('subagent-test');

    expect(run.status).toBe('completed');
    expect(run.stepResults.get('s1')?.status).toBe('completed');
    expect(run.stepResults.get('s1')?.output).toBe('research complete');
    expect(mocks.MockSubAgentEngine).toHaveBeenCalledTimes(1);
    expect(mocks.mockSpawn).toHaveBeenCalledWith(
      'Research topic X',
      deps.tools,
      expect.objectContaining({ definitionName: 'researcher' }),
    );
  });

  it('should return output when subAgent succeeds', async () => {
    mocks.mockSpawn.mockResolvedValue({
      output: 'detailed findings here',
      success: true,
      tokensUsed: 250,
      toolCalls: 5,
    });

    const deps = createMockDeps();
    const wf: WorkflowDefinition = {
      name: 'subagent-success',
      steps: [{
        id: 's1',
        prompt: 'Find all issues',
        subAgent: { definitionName: 'coder' },
      }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    const run = await engine.run('subagent-success');

    expect(run.stepResults.get('s1')?.output).toBe('detailed findings here');
    expect(run.stepResults.get('s1')?.status).toBe('completed');
  });

  it('should throw error when subAgent fails', async () => {
    mocks.mockSpawn.mockResolvedValue({
      output: '',
      success: false,
      tokensUsed: 10,
      toolCalls: 0,
      error: 'Model rate limit exceeded',
    });

    const deps = createMockDeps();
    const wf: WorkflowDefinition = {
      name: 'subagent-fail',
      steps: [{
        id: 's1',
        prompt: 'Impossible task',
        subAgent: { definitionName: 'broken-agent' },
      }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    const run = await engine.run('subagent-fail');

    // The engine catches the error and marks the step as failed
    expect(run.stepResults.get('s1')?.status).toBe('failed');
    expect(run.stepResults.get('s1')?.error).toContain('Sub-agent failed');
  });

  it('should use runAgent for steps without subAgent', async () => {
    const deps = createMockDeps();

    const wf: WorkflowDefinition = {
      name: 'no-subagent',
      steps: [{ id: 's1', prompt: 'Simple task' }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    const run = await engine.run('no-subagent');

    expect(run.status).toBe('completed');
    expect(run.stepResults.get('s1')?.output).toBe('agent-response');
    // SubAgentEngine should NOT have been constructed
    expect(mocks.MockSubAgentEngine).not.toHaveBeenCalled();
    // provider.chat should have been called (runAgent path)
    expect(deps.provider.chat).toHaveBeenCalled();
  });

  it('should not call SubAgentEngine.spawn when step has tools (tools take priority)', async () => {
    const deps = createMockDeps();

    mocks.mockSpawn.mockResolvedValue({
      output: 'should not be used',
      success: true,
      tokensUsed: 0,
      toolCalls: 0,
    });

    const wf: WorkflowDefinition = {
      name: 'tools-priority',
      steps: [{
        id: 's1',
        prompt: 'Has both tools and subAgent',
        tools: ['bash'],
        subAgent: { definitionName: 'worker' },
      }],
      triggers: [{ type: 'manual' }],
    };
    await registry.create(wf);
    const engine = new WorkflowEngine(deps, registry);

    // The tools path requires AgentLoop which we haven't mocked here.
    // The step will fail, but we verify SubAgentEngine.spawn was NOT called.
    const run = await engine.run('tools-priority');

    // Tools path is checked before subAgent in engine logic
    expect(mocks.mockSpawn).not.toHaveBeenCalled();
  });
});
