import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator, type OrchestratorEvent } from '../src/core/orchestrator.js';
import type { AgentDeps } from '../src/core/agent.js';
import type { TaskResult } from '../src/core/task.js';

function createMockDeps(): AgentDeps {
  const mockProvider = {
    chat: vi.fn().mockResolvedValue({
      content: 'done',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }),
    summarize: vi.fn().mockResolvedValue('summary'),
  };

  const mockSessions = {
    createSession: vi.fn().mockReturnValue('sess_1'),
    loadMessages: vi.fn().mockResolvedValue([]),
    saveMessages: vi.fn().mockResolvedValue(undefined),
  };

  const mockHooks = {
    emit: vi.fn().mockResolvedValue(undefined),
  };

  const mockConfig = {
    get: vi.fn().mockReturnValue({
      context: { maxTurns: 10, compressionThreshold: 0.8, keepLastN: 10 },
      memory: { enabled: false },
    }),
    getConfigDir: vi.fn().mockReturnValue('/tmp/xiaobai-test'),
  };

  const mockMemory = {
    getSystemPromptBlock: vi.fn().mockResolvedValue(null),
    flushIfDirty: vi.fn().mockResolvedValue(undefined),
  };

  const mockSecurity = {
    checkPermission: vi.fn().mockResolvedValue(true),
  };

  const mockTools = {
    getToolDefinitions: vi.fn().mockReturnValue([
      { name: 'read', description: 'Read file', parameters: { type: 'object', properties: {} } },
      { name: 'write', description: 'Write file', parameters: { type: 'object', properties: {} } },
      { name: 'bash', description: 'Run bash', parameters: { type: 'object', properties: {} } },
    ]),
    execute: vi.fn().mockResolvedValue({
      output: 'tool result',
      success: true,
    }),
    has: vi.fn().mockReturnValue(true),
    list: vi.fn().mockReturnValue(['read', 'write', 'bash']),
  };

  return {
    config: mockConfig as any,
    provider: mockProvider as any,
    tools: mockTools as any,
    sessions: mockSessions as any,
    hooks: mockHooks as any,
    memory: mockMemory as any,
    security: mockSecurity as any,
  };
}

describe('Orchestrator', () => {
  let deps: AgentDeps;
  let events: OrchestratorEvent[];

  beforeEach(() => {
    deps = createMockDeps();
    events = [];
  });

  it('adds tasks and returns them', () => {
    const orch = new Orchestrator(deps);
    const t1 = orch.addTask({ description: 'Research auth', role: 'researcher' });
    const t2 = orch.addTask({ description: 'Fix bug', role: 'coder' });

    const tasks = orch.getTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe(t1.id);
    expect(tasks[1].id).toBe(t2.id);
  });

  it('gets task by id', () => {
    const orch = new Orchestrator(deps);
    const task = orch.addTask({ description: 'Test', role: 'tester' });

    const found = orch.getTask(task.id);
    expect(found?.description).toBe('Test');

    expect(orch.getTask('nonexistent')).toBeUndefined();
  });

  it('executes a single task and collects results', async () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.addTask({ description: 'Say hello', role: 'researcher' });

    const results = await orch.execute({
      onEvent: (e) => events.push(e),
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].output).toContain('done');

    const started = events.find((e) => e.type === 'task_started');
    expect(started).toBeDefined();

    const completed = events.find((e) => e.type === 'task_completed');
    expect(completed).toBeDefined();

    const allDone = events.find((e) => e.type === 'all_completed');
    expect(allDone).toBeDefined();
  });

  it('executes tasks with dependencies sequentially', async () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    const t1 = orch.addTask({ description: 'Step 1', role: 'researcher' });
    const t2 = orch.addTask({
      description: 'Step 2',
      role: 'coder',
      dependencies: [t1.id],
    });

    const results = await orch.execute();

    expect(results).toHaveLength(2);
    expect(results[0].taskId).toBe(t1.id);
    expect(results[1].taskId).toBe(t2.id);
  });

  it('emits plan event at start', async () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.addTask({ description: 'T1', role: 'researcher' });

    await orch.execute({ onEvent: (e) => events.push(e) });

    const plan = events.find((e) => e.type === 'plan');
    expect(plan).toBeDefined();
    if (plan?.type === 'plan') {
      expect(plan.tasks).toHaveLength(1);
    }
  });

  it('respects abort signal', async () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.addTask({ description: 'T1', role: 'researcher' });

    const controller = new AbortController();
    controller.abort();

    const results = await orch.execute({ abortSignal: controller.signal });

    const tasks = orch.getTasks();
    expect(tasks[0].status).toBe('cancelled');
  });

  it('reports agent status', async () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.addTask({ description: 'T1', role: 'researcher' });

    await orch.execute();

    const status = orch.getAgentStatus();
    expect(status.length).toBeGreaterThanOrEqual(1);
    expect(status[0].role).toBe('researcher');
    expect(status[0].busy).toBe(false);
  });

  it('provides workspace access', () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    const ws = orch.getWorkspace();
    expect(ws).toBeDefined();
    expect(ws.getBaseDir()).toContain('xiaobai-test-ws');
  });

  it('returns empty results when no tasks', async () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    const results = await orch.execute();
    expect(results).toHaveLength(0);
  });

  it('collects results via getResults', async () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.addTask({ description: 'T1', role: 'researcher' });
    await orch.execute();

    const results = orch.getResults();
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });
});
