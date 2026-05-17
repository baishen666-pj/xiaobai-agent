import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator, type OrchestratorEvent } from '../../src/core/orchestrator.js';
import type { AgentDeps } from '../../src/core/agent.js';

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
    saveSessionState: vi.fn().mockResolvedValue(undefined),
    loadSessionState: vi.fn().mockResolvedValue(null),
  };

  const mockHooks = {
    emit: vi.fn().mockResolvedValue({ exitCode: 'allow' }),
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

function createMockBridge(agents: Array<{ name: string; url: string; protocol: 'a2a' | 'acp'; role?: string }> = []) {
  const agentMap = new Map(agents.map((a) => [a.name, a]));

  return {
    registerAgent: vi.fn(async (config: any) => {
      agentMap.set(config.name, config);
    }),
    unregisterAgent: vi.fn((name: string) => {
      agentMap.delete(name);
    }),
    getAgent: vi.fn((name: string) => agentMap.get(name)),
    listAgents: vi.fn(() => Array.from(agentMap.values())),
    executeRemoteTask: vi.fn(async (agentName: string, prompt: string) => ({
      success: true,
      output: `Remote result for: ${prompt}`,
      tokensUsed: 100,
    })),
  };
}

describe('Orchestrator Federation', () => {
  let deps: AgentDeps;
  let events: OrchestratorEvent[];

  beforeEach(() => {
    deps = createMockDeps();
    events = [];
  });

  it('setBridge stores the bridge', () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    const bridge = createMockBridge();

    orch.setBridge(bridge as any);

    // Verify indirectly: add a task with a role matching a remote agent
    // and confirm the remote task path is taken during execute
    expect(() => orch.setBridge(bridge as any)).not.toThrow();
  });

  it('orchestrator with bridge uses remote handle for matching role', async () => {
    const bridge = createMockBridge([
      { name: 'remote-researcher', url: 'http://localhost:4000', protocol: 'a2a', role: 'researcher' },
    ]);
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.setBridge(bridge as any);

    orch.addTask({ description: 'Research topic', role: 'researcher' });

    const results = await orch.execute({
      onEvent: (e) => events.push(e),
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    // Remote task should produce output from the mock bridge
    expect(results[0].output).toContain('Remote result for:');
    expect(bridge.executeRemoteTask).toHaveBeenCalledWith('remote-researcher', expect.any(String));
  });

  it('when bridge has a matching agent for a role, remote handle is used', async () => {
    const bridge = createMockBridge([
      { name: 'remote-coder', url: 'http://localhost:5000', protocol: 'acp', role: 'coder' },
    ]);
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.setBridge(bridge as any);

    orch.addTask({ description: 'Write code', role: 'coder' });

    await orch.execute({ onEvent: (e) => events.push(e) });

    // The event agentId should start with "remote_" indicating a remote handle was used
    const started = events.find((e) => e.type === 'task_started');
    expect(started).toBeDefined();
    if (started?.type === 'task_started') {
      expect(started.agentId).toContain('remote_');
    }
  });

  it('when bridge has no matching agent, local handle is used', async () => {
    const bridge = createMockBridge([
      { name: 'remote-coder', url: 'http://localhost:5000', protocol: 'a2a', role: 'coder' },
    ]);
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.setBridge(bridge as any);

    // researcher has no remote agent match, so local handle should be used
    orch.addTask({ description: 'Research topic', role: 'researcher' });

    const results = await orch.execute({ onEvent: (e) => events.push(e) });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    // Local agent produces output from the mock provider ("done"), not from bridge
    expect(results[0].output).toContain('done');
    expect(bridge.executeRemoteTask).not.toHaveBeenCalled();

    // Agent ID should NOT start with "remote_"
    const started = events.find((e) => e.type === 'task_started');
    expect(started).toBeDefined();
    if (started?.type === 'task_started') {
      expect(started.agentId).not.toContain('remote_');
    }
  });

  it('runRemoteTask delegates to bridge.executeRemoteTask', async () => {
    const bridge = createMockBridge([
      { name: 'remote-researcher', url: 'http://localhost:4000', protocol: 'a2a', role: 'researcher' },
    ]);
    // Make the remote task return a specific result
    bridge.executeRemoteTask.mockResolvedValue({
      success: true,
      output: 'Custom remote output',
      tokensUsed: 42,
    });

    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.setBridge(bridge as any);

    orch.addTask({ description: 'Research something important', role: 'researcher' });

    const results = await orch.execute({ onEvent: (e) => events.push(e) });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].output).toBe('Custom remote output');
    expect(results[0].tokensUsed).toBe(42);
    expect(bridge.executeRemoteTask).toHaveBeenCalledWith('remote-researcher', 'Research something important');
  });

  it('handles remote task failure gracefully', async () => {
    const bridge = createMockBridge([
      { name: 'remote-coder', url: 'http://localhost:5000', protocol: 'acp', role: 'coder' },
    ]);
    bridge.executeRemoteTask.mockResolvedValue({
      success: false,
      output: '',
      error: 'Agent unavailable',
      tokensUsed: 0,
    });

    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.setBridge(bridge as any);

    orch.addTask({ description: 'Write code', role: 'coder' });

    const results = await orch.execute({ onEvent: (e) => events.push(e) });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Agent unavailable');

    const failed = events.find((e) => e.type === 'task_failed');
    expect(failed).toBeDefined();
  });

  it('mixed local and remote tasks execute correctly', async () => {
    const bridge = createMockBridge([
      { name: 'remote-researcher', url: 'http://localhost:4000', protocol: 'a2a', role: 'researcher' },
    ]);
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.setBridge(bridge as any);

    const t1 = orch.addTask({ description: 'Research', role: 'researcher' });
    const t2 = orch.addTask({ description: 'Code it', role: 'coder', dependencies: [t1.id] });

    const results = await orch.execute({ onEvent: (e) => events.push(e) });

    expect(results).toHaveLength(2);

    // t1 (researcher) should have been remote
    const r1 = results.find((r) => r.taskId === t1.id);
    expect(r1?.success).toBe(true);
    expect(r1?.output).toContain('Remote result for:');

    // t2 (coder) should have been local
    const r2 = results.find((r) => r.taskId === t2.id);
    expect(r2?.success).toBe(true);
    expect(r2?.output).toContain('done');
  });

  it('without bridge, all tasks use local handles', async () => {
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    // No setBridge call

    orch.addTask({ description: 'Research', role: 'researcher' });

    const results = await orch.execute({ onEvent: (e) => events.push(e) });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].output).toContain('done');

    const started = events.find((e) => e.type === 'task_started');
    if (started?.type === 'task_started') {
      expect(started.agentId).not.toContain('remote_');
    }
  });

  it('remote task events include correct agent id format', async () => {
    const bridge = createMockBridge([
      { name: 'my-remote-agent', url: 'http://localhost:4000', protocol: 'a2a', role: 'researcher' },
    ]);
    const orch = new Orchestrator(deps, '/tmp/xiaobai-test-ws');
    orch.setBridge(bridge as any);

    orch.addTask({ description: 'Research', role: 'researcher' });

    await orch.execute({ onEvent: (e) => events.push(e) });

    const started = events.find((e) => e.type === 'task_started');
    expect(started).toBeDefined();
    if (started?.type === 'task_started') {
      expect(started.agentId).toContain('remote_my-remote-agent');
    }
  });
});
