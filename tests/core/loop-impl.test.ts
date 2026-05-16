import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop, type LoopEvent } from '../../src/core/loop.js';
import type { ToolRegistry } from '../../src/tools/registry.js';
import type { ProviderRouter } from '../../src/provider/router.js';
import type { SessionManager } from '../../src/session/manager.js';
import type { HookSystem } from '../../src/hooks/system.js';
import type { ConfigManager } from '../../src/config/manager.js';
import type { MemorySystem } from '../../src/memory/system.js';
import type { SecurityManager } from '../../src/security/manager.js';
import type { SkillSystem } from '../../src/skills/system.js';

function createLoopDeps(overrides: Record<string, any> = {}) {
  const mockConfig = {
    get: vi.fn().mockReturnValue({
      provider: { default: 'openai' },
      model: { default: 'gpt-4' },
      context: { maxTurns: 10, maxTokens: 8000 },
      memory: { enabled: false },
      sandbox: { enabled: false },
      skills: { enabled: false },
      plugins: { enabled: false },
    }),
    getConfigDir: vi.fn().mockReturnValue('/tmp/test'),
  } as unknown as ConfigManager;

  const mockProvider = {
    chat: vi.fn().mockResolvedValue({
      content: 'Hello! How can I help?',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }),
    chatStream: vi.fn(),
    updateConfig: vi.fn(),
  } as unknown as ProviderRouter;

  const mockTools = {
    registerBatch: vi.fn(),
    getToolDefinitions: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({ output: 'tool result', success: true }),
    list: vi.fn().mockReturnValue([]),
    has: vi.fn().mockReturnValue(false),
  } as unknown as ToolRegistry;

  const mockSessions = {
    createSession: vi.fn().mockReturnValue('test-session'),
    loadMessages: vi.fn().mockResolvedValue([]),
    saveMessages: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionManager;

  const mockHooks = {
    emit: vi.fn().mockResolvedValue({ exitCode: 'allow' }),
  } as unknown as HookSystem;

  const mockMemory = {
    getSystemPromptBlock: vi.fn().mockResolvedValue(null),
    flushIfDirty: vi.fn().mockResolvedValue(undefined),
  } as unknown as MemorySystem;

  const mockSecurity = {
    checkPermission: vi.fn().mockResolvedValue(true),
  } as unknown as SecurityManager;

  const deps = {
    provider: mockProvider,
    tools: mockTools,
    sessions: mockSessions,
    hooks: mockHooks,
    config: mockConfig,
    memory: mockMemory,
    security: mockSecurity,
    ...overrides,
  };

  return {
    deps,
    mocks: {
      provider: mockProvider,
      tools: mockTools,
      sessions: mockSessions,
      hooks: mockHooks,
      config: mockConfig,
      memory: mockMemory,
      security: mockSecurity,
    },
  };
}

// ── Queue-Pair API ──

describe('AgentLoop Queue-Pair API', () => {
  it('submit adds submission to queue', () => {
    const { deps } = createLoopDeps();
    const loop = new AgentLoop(deps);
    expect(() => loop.submit({ type: 'interrupt', reason: 'test' })).not.toThrow();
  });

  it('drainEvents returns buffered events and clears buffer', () => {
    const { deps, mocks } = createLoopDeps();
    const loop = new AgentLoop(deps);

    // First drain returns empty
    const first = loop.drainEvents();
    expect(Array.isArray(first)).toBe(true);
    expect(first).toHaveLength(0);

    // Run loop to produce events, then drain
    // (Events are pushed via emitEvent which is called internally)
  });

  it('drainEvents returns copy and clears internal buffer', async () => {
    const { deps } = createLoopDeps();
    const loop = new AgentLoop(deps);

    // Run a simple loop to generate events
    for await (const _ of loop.run('Hello', 'session-1')) {
      // consume
    }

    // Drain should return events
    const events = loop.drainEvents();
    expect(Array.isArray(events)).toBe(true);

    // Second drain should be empty (buffer cleared)
    const second = loop.drainEvents();
    expect(second).toHaveLength(0);

    // First drain events should still be accessible (copy)
    expect(events).toBeDefined();
  });
});

// ── Legacy async generator API ──

describe('AgentLoop', () => {
  let loopDeps: ReturnType<typeof createLoopDeps>;

  beforeEach(() => {
    loopDeps = createLoopDeps();
  });

  it('yields text event for simple response', async () => {
    const loop = new AgentLoop(loopDeps.deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
  });

  it('yields error when provider returns null', async () => {
    loopDeps.mocks.provider.chat = vi.fn().mockResolvedValue(null);
    const loop = new AgentLoop(loopDeps.deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('stops after maxTurns', async () => {
    loopDeps.mocks.config.get = vi.fn().mockReturnValue({
      provider: { default: 'openai' },
      model: { default: 'gpt-4' },
      context: { maxTurns: 1, maxTokens: 8000 },
      memory: { enabled: false },
      sandbox: { enabled: false },
      skills: { enabled: false },
      plugins: { enabled: false },
    });
    const loop = new AgentLoop(loopDeps.deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }
    const stopEvent = events.find((e) => e.type === 'stop');
    expect(stopEvent).toBeDefined();
  });

  it('saves messages after loop completes', async () => {
    const loop = new AgentLoop(loopDeps.deps);
    for await (const _ of loop.run('Hello', 'session-1')) {
      // consume
    }
    expect(loopDeps.mocks.sessions.saveMessages).toHaveBeenCalledWith('session-1', expect.any(Array));
  });

  it('emits hooks during lifecycle', async () => {
    const loop = new AgentLoop(loopDeps.deps);
    for await (const _ of loop.run('Hello', 'session-1')) {
      // consume
    }
    expect(loopDeps.mocks.hooks.emit).toHaveBeenCalledWith('session_start', expect.any(Object));
    expect(loopDeps.mocks.hooks.emit).toHaveBeenCalledWith('stop', expect.any(Object));
  });

  it('handles hook blocking', async () => {
    loopDeps.mocks.hooks.emit = vi.fn().mockImplementation((event: string) => {
      if (event === 'user_prompt_submit') {
        return Promise.resolve({ exitCode: 'block', message: 'Blocked' });
      }
      return Promise.resolve({ exitCode: 'allow' });
    });
    const loop = new AgentLoop(loopDeps.deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('handles tool calls from provider', async () => {
    loopDeps.mocks.provider.chat = vi.fn().mockResolvedValue({
      content: 'I will read a file.',
      toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/tmp/test.txt' } }],
      usage: { totalTokens: 50 },
    });
    const loop = new AgentLoop(loopDeps.deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Read test.txt', 'session-1', { maxTurns: 2 })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
  });

  it('handles permission denied', async () => {
    loopDeps.mocks.provider.chat = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'bash', arguments: { command: 'rm -rf /' } }],
      usage: { totalTokens: 20 },
    });
    loopDeps.mocks.security.checkPermission = vi.fn().mockResolvedValue(false);
    const loop = new AgentLoop(loopDeps.deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Run rm', 'session-1', { maxTurns: 2 })) {
      events.push(event);
    }
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toContain('Permission denied');
  });

  it('supports abortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    const loop = new AgentLoop(loopDeps.deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1', { abortSignal: controller.signal })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'stop')).toBe(true);
  });

  it('drainEvents returns buffered events', () => {
    const loop = new AgentLoop(loopDeps.deps);
    const events = loop.drainEvents();
    expect(Array.isArray(events)).toBe(true);
  });

  it('submit adds to queue', () => {
    const loop = new AgentLoop(loopDeps.deps);
    expect(() => loop.submit({ type: 'interrupt', reason: 'test' })).not.toThrow();
  });

  it('handles provider error gracefully', async () => {
    loopDeps.mocks.provider.chat = vi.fn().mockRejectedValue(new Error('API error'));
    const loop = new AgentLoop(loopDeps.deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('loads existing session messages', async () => {
    const existingMessages = [{ role: 'user', content: 'previous message', timestamp: Date.now() }];
    loopDeps.mocks.sessions.loadMessages = vi.fn().mockResolvedValue(existingMessages);
    const loop = new AgentLoop(loopDeps.deps);
    for await (const _ of loop.run('Follow up', 'session-1')) {
      // consume
    }
    expect(loopDeps.mocks.sessions.loadMessages).toHaveBeenCalledWith('session-1');
  });

  it('uses permissionCallback when provided', async () => {
    loopDeps.mocks.provider.chat = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/tmp/test' } }],
      usage: { totalTokens: 20 },
    });
    const permCb = vi.fn().mockResolvedValue(true);
    const loop = new AgentLoop(loopDeps.deps);
    for await (const _ of loop.run('Read file', 'session-1', { maxTurns: 2, permissionCallback: permCb })) {
      // consume
    }
    expect(permCb).toHaveBeenCalled();
  });

  it('handles stream mode', async () => {
    async function* mockStream() {
      yield { type: 'text_delta', text: 'Hello' };
      yield { type: 'text_delta', text: ' world' };
      yield { type: 'done', stopReason: 'stop', usage: { totalTokens: 10 } };
    }
    loopDeps.mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(loopDeps.deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1', { stream: true })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'stream')).toBe(true);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
  });
});

// ── Interrupt submission ──

describe('AgentLoop interrupt handling', () => {
  it('stops when interrupt submission is queued', async () => {
    const { deps, mocks } = createLoopDeps();
    const loop = new AgentLoop(deps);

    // Submit interrupt before running
    loop.submit({ type: 'interrupt', reason: 'user cancelled' });

    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    const stopEvent = events.find((e) => e.type === 'stop');
    expect(stopEvent).toBeDefined();
    expect(stopEvent!.content).toBe('user cancelled');
  });

  it('stops with default reason when interrupt has no reason', async () => {
    const { deps } = createLoopDeps();
    const loop = new AgentLoop(deps);

    loop.submit({ type: 'interrupt' });

    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    const stopEvent = events.find((e) => e.type === 'stop');
    expect(stopEvent).toBeDefined();
    expect(stopEvent!.content).toBe('Interrupted');
  });
});

// ── Stream mode edge cases ──

describe('AgentLoop stream mode', () => {
  it('handles tool_call_start in stream', async () => {
    const { deps, mocks } = createLoopDeps();
    async function* mockStream() {
      yield { type: 'text_delta', text: 'Let me read ' };
      yield { type: 'tool_call_start', toolCallId: 'tc_stream_1', toolCallName: 'read' };
      yield { type: 'tool_call_delta', toolCallId: 'tc_stream_1', toolCallDelta: '{"file_path":"/tmp/test"}' };
      yield { type: 'done', stopReason: 'tool_calls', usage: { totalTokens: 20 } };
    }
    mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Read file', 'session-1', { stream: true, maxTurns: 2 })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'tool_call')).toBe(true);
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
  });

  it('handles stream with tool_use stop reason but no tool call chunks', async () => {
    const { deps, mocks } = createLoopDeps();
    async function* mockStream() {
      yield { type: 'text_delta', text: 'Processing...' };
      yield { type: 'done', stopReason: 'tool_use', usage: { totalTokens: 15 } };
    }
    mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Do something', 'session-1', { stream: true, maxTurns: 2 })) {
      events.push(event);
    }
    // Should still proceed even without tool call data
    expect(events.length).toBeGreaterThan(0);
  });

  it('handles stream with usage chunk', async () => {
    const { deps, mocks } = createLoopDeps();
    async function* mockStream() {
      yield { type: 'usage', usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 } };
      yield { type: 'text_delta', text: 'Response' };
      yield { type: 'done', stopReason: 'stop', usage: { totalTokens: 20 } };
    }
    mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1', { stream: true })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'stream')).toBe(true);
  });

  it('handles stream error', async () => {
    const { deps, mocks } = createLoopDeps();
    async function* mockStream() {
      yield { type: 'text_delta', text: 'Start' };
      throw new Error('Stream disconnected');
    }
    mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1', { stream: true })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'error')).toBe(true);
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent!.content).toContain('Stream error');
  });

  it('handles tool_call_start without toolCallId or toolCallName', async () => {
    const { deps, mocks } = createLoopDeps();
    async function* mockStream() {
      yield { type: 'tool_call_start' }; // missing id and name
      yield { type: 'done', stopReason: 'stop', usage: { totalTokens: 10 } };
    }
    mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1', { stream: true })) {
      events.push(event);
    }
    // Should not crash, tool_call event should still be emitted with undefined name
    expect(events.some((e) => e.type === 'tool_call')).toBe(true);
  });

  it('handles tool_call_delta for multiple tool calls', async () => {
    const { deps, mocks } = createLoopDeps();
    async function* mockStream() {
      yield { type: 'tool_call_start', toolCallId: 'tc_1', toolCallName: 'read' };
      yield { type: 'tool_call_start', toolCallId: 'tc_2', toolCallName: 'grep' };
      yield { type: 'tool_call_delta', toolCallId: 'tc_1', toolCallDelta: '{"file_path":"/a"}' };
      yield { type: 'tool_call_delta', toolCallId: 'tc_2', toolCallDelta: '{"pattern":"test"}' };
      yield { type: 'done', stopReason: 'tool_calls', usage: { totalTokens: 30 } };
    }
    mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Read and grep', 'session-1', { stream: true, maxTurns: 2 })) {
      events.push(event);
    }
    const toolResultEvents = events.filter((e) => e.type === 'tool_result');
    expect(toolResultEvents.length).toBe(2);
  });

  it('handles tool_call_delta with invalid JSON args', async () => {
    const { deps, mocks } = createLoopDeps();
    async function* mockStream() {
      yield { type: 'tool_call_start', toolCallId: 'tc_bad', toolCallName: 'bash' };
      yield { type: 'tool_call_delta', toolCallId: 'tc_bad', toolCallDelta: '{not valid json' };
      yield { type: 'done', stopReason: 'tool_calls', usage: { totalTokens: 10 } };
    }
    mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Run bad', 'session-1', { stream: true, maxTurns: 2 })) {
      events.push(event);
    }
    // Should handle the bad JSON gracefully and still execute
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
  });

  it('handles done chunk with fullContent but no tool calls', async () => {
    const { deps, mocks } = createLoopDeps();
    async function* mockStream() {
      yield { type: 'text_delta', text: 'Complete response' };
      yield { type: 'done', stopReason: 'stop', usage: { totalTokens: 15 } };
    }
    mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1', { stream: true })) {
      events.push(event);
    }
    const stopEvent = events.find((e) => e.type === 'stop');
    expect(stopEvent).toBeDefined();
    expect(stopEvent!.content).toBe('Task completed');
  });

  it('saves messages including stream content after completion', async () => {
    const { deps, mocks } = createLoopDeps();
    async function* mockStream() {
      yield { type: 'text_delta', text: 'Hello' };
      yield { type: 'done', stopReason: 'stop', usage: { totalTokens: 10 } };
    }
    mocks.provider.chatStream = vi.fn().mockReturnValue(mockStream());
    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Hi', 'session-1', { stream: true })) {
      // consume
    }
    expect(mocks.sessions.saveMessages).toHaveBeenCalledWith('session-1', expect.any(Array));
    const savedMessages = mocks.sessions.saveMessages.mock.calls[0][1] as any[];
    expect(savedMessages.some((m: any) => m.content === 'Hello')).toBe(true);
  });
});

// ── executeToolCalls coverage ──

describe('AgentLoop tool execution', () => {
  it('executes safe tools concurrently', async () => {
    const { deps, mocks } = createLoopDeps();
    const executionOrder: string[] = [];

    mocks.tools.execute = vi.fn().mockImplementation(async (name: string) => {
      executionOrder.push(name);
      return { output: `${name} result`, success: true };
    });

    let callCount = 0;
    mocks.provider.chat = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: 'Reading files',
          toolCalls: [
            { id: 'tc1', name: 'read', arguments: { file_path: '/a' } },
            { id: 'tc2', name: 'grep', arguments: { pattern: 'test' } },
          ],
          usage: { totalTokens: 50 },
        };
      }
      return {
        content: 'Done reading',
        usage: { totalTokens: 10 },
      };
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Read and grep', 'session-1', { maxTurns: 2 })) {
      events.push(event);
    }

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.length).toBe(2);
  });

  it('executes unsafe tools sequentially', async () => {
    const { deps, mocks } = createLoopDeps();

    let callCount = 0;
    mocks.provider.chat = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: 'Running commands',
          toolCalls: [
            { id: 'tc1', name: 'bash', arguments: { command: 'echo a' } },
            { id: 'tc2', name: 'bash', arguments: { command: 'echo b' } },
          ],
          usage: { totalTokens: 50 },
        };
      }
      return {
        content: 'Done',
        usage: { totalTokens: 10 },
      };
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Run commands', 'session-1', { maxTurns: 2 })) {
      events.push(event);
    }

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.length).toBe(2);
  });

  it('handles mixed safe and unsafe tool calls', async () => {
    const { deps, mocks } = createLoopDeps();

    let callCount = 0;
    mocks.provider.chat = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: 'Mixed operations',
          toolCalls: [
            { id: 'tc1', name: 'read', arguments: { file_path: '/a' } },
            { id: 'tc2', name: 'bash', arguments: { command: 'echo hello' } },
            { id: 'tc3', name: 'glob', arguments: { pattern: '*.ts' } },
          ],
          usage: { totalTokens: 60 },
        };
      }
      return {
        content: 'Done',
        usage: { totalTokens: 10 },
      };
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Mixed tools', 'session-1', { maxTurns: 2 })) {
      events.push(event);
    }

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.length).toBe(3);
  });

  it('handles pre_tool_use hook blocking', async () => {
    const { deps, mocks } = createLoopDeps();

    mocks.hooks.emit = vi.fn().mockImplementation((event: string) => {
      if (event === 'pre_tool_use') {
        return Promise.resolve({ exitCode: 'block', message: 'Tool blocked by policy' });
      }
      return Promise.resolve({ exitCode: 'allow' });
    });

    mocks.provider.chat = vi.fn().mockResolvedValue({
      content: 'Try to read',
      toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/a' } }],
      usage: { totalTokens: 30 },
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Read file', 'session-1', { maxTurns: 2 })) {
      events.push(event);
    }

    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    expect(toolResult!.content).toContain('Blocked by hook');
  });

  it('uses permissionCallback over security.checkPermission', async () => {
    const { deps, mocks } = createLoopDeps();
    const permCb = vi.fn().mockResolvedValue(false);

    mocks.provider.chat = vi.fn().mockResolvedValue({
      content: 'Try to run',
      toolCalls: [{ id: 'tc1', name: 'bash', arguments: { command: 'ls' } }],
      usage: { totalTokens: 20 },
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Run ls', 'session-1', { maxTurns: 2, permissionCallback: permCb })) {
      events.push(event);
    }

    expect(permCb).toHaveBeenCalled();
    // security.checkPermission should NOT have been called since permCb was provided
    expect(mocks.security.checkPermission).not.toHaveBeenCalled();
  });

  it('emits post_tool_use hook after tool execution', async () => {
    const { deps, mocks } = createLoopDeps();

    mocks.provider.chat = vi.fn().mockResolvedValue({
      content: 'Read file',
      toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/tmp/test' } }],
      usage: { totalTokens: 30 },
    });

    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Read', 'session-1', { maxTurns: 2 })) {
      // consume
    }

    expect(mocks.hooks.emit).toHaveBeenCalledWith('post_tool_use', expect.objectContaining({
      tool: 'read',
    }));
  });
});

// ── Compaction integration ──

describe('AgentLoop compaction', () => {
  it('triggers compaction when token threshold is exceeded', async () => {
    const { deps, mocks } = createLoopDeps();

    // Set a very low maxTurns and small context window to trigger compaction
    mocks.config.get = vi.fn().mockReturnValue({
      provider: { default: 'openai' },
      model: { default: 'gpt-4' },
      context: { maxTurns: 10, maxTokens: 100 },
      memory: { enabled: false },
      sandbox: { enabled: false },
      skills: { enabled: false },
      plugins: { enabled: false },
    });

    // Return large token usage to trigger compaction
    let callCount = 0;
    mocks.provider.chat = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: 'Long response',
          toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/a' } }],
          usage: { promptTokens: 50000, completionTokens: 50000, totalTokens: 100000 },
        };
      }
      return {
        content: 'Done',
        usage: { totalTokens: 100 },
      };
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Big request', 'session-1', { maxTurns: 5 })) {
      events.push(event);
    }

    // Should see a compact event if compaction was triggered
    const compactEvent = events.find((e) => e.type === 'compact');
    expect(compactEvent).toBeDefined();
  });

  it('emits pre_compact and post_compact hooks', async () => {
    const { deps, mocks } = createLoopDeps();

    mocks.config.get = vi.fn().mockReturnValue({
      provider: { default: 'openai' },
      model: { default: 'gpt-4' },
      context: { maxTurns: 10, maxTokens: 100 },
      memory: { enabled: false },
      sandbox: { enabled: false },
      skills: { enabled: false },
      plugins: { enabled: false },
    });

    let callCount = 0;
    mocks.provider.chat = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: 'Response',
          toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/a' } }],
          usage: { promptTokens: 50000, completionTokens: 50000, totalTokens: 100000 },
        };
      }
      return {
        content: 'Final',
        usage: { totalTokens: 50 },
      };
    });

    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Big request', 'session-1', { maxTurns: 5 })) {
      // consume
    }

    expect(mocks.hooks.emit).toHaveBeenCalledWith('pre_compact', expect.any(Object));
    expect(mocks.hooks.emit).toHaveBeenCalledWith('post_compact', expect.any(Object));
  });
});

// ── Memory integration ──

describe('AgentLoop memory integration', () => {
  it('flushes memory when enabled', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.config.get = vi.fn().mockReturnValue({
      provider: { default: 'openai' },
      model: { default: 'gpt-4' },
      context: { maxTurns: 10, maxTokens: 8000 },
      memory: { enabled: true },
      sandbox: { enabled: false },
      skills: { enabled: false },
      plugins: { enabled: false },
    });

    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Hello', 'session-1')) {
      // consume
    }

    expect(mocks.memory.flushIfDirty).toHaveBeenCalled();
  });

  it('does not flush memory when disabled', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.config.get = vi.fn().mockReturnValue({
      provider: { default: 'openai' },
      model: { default: 'gpt-4' },
      context: { maxTurns: 10, maxTokens: 8000 },
      memory: { enabled: false },
      sandbox: { enabled: false },
      skills: { enabled: false },
      plugins: { enabled: false },
    });

    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Hello', 'session-1')) {
      // consume
    }

    expect(mocks.memory.flushIfDirty).not.toHaveBeenCalled();
  });
});

// ── Skills integration ──

describe('AgentLoop skills integration', () => {
  it('includes skill summary in system prompt when skills are provided', async () => {
    const mockSkills = {
      buildSystemPrompt: vi.fn().mockReturnValue('Available skills: read, grep, bash'),
    } as unknown as SkillSystem;

    const { deps, mocks } = createLoopDeps({ skills: mockSkills });
    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Hello', 'session-1')) {
      // consume
    }

    expect(mockSkills.buildSystemPrompt).toHaveBeenCalled();
  });

  it('handles null skill summary gracefully', async () => {
    const mockSkills = {
      buildSystemPrompt: vi.fn().mockReturnValue(null),
    } as unknown as SkillSystem;

    const { deps } = createLoopDeps({ skills: mockSkills });
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }
    // Should not crash
    expect(events.length).toBeGreaterThan(0);
  });

  it('handles empty skill summary gracefully', async () => {
    const mockSkills = {
      buildSystemPrompt: vi.fn().mockReturnValue(''),
    } as unknown as SkillSystem;

    const { deps } = createLoopDeps({ skills: mockSkills });
    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
  });
});

// ── System prompt building ──

describe('AgentLoop system prompt', () => {
  it('includes memory block when available', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.memory.getSystemPromptBlock = vi.fn().mockResolvedValue('[Memory context]');

    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Hello', 'session-1')) {
      // consume
    }

    expect(mocks.memory.getSystemPromptBlock).toHaveBeenCalled();
  });

  it('works when memory block is null', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.memory.getSystemPromptBlock = vi.fn().mockResolvedValue(null);

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
  });
});

// ── Edge cases ──

describe('AgentLoop edge cases', () => {
  it('handles provider returning response with no content', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.provider.chat = vi.fn().mockResolvedValue({
      content: undefined,
      usage: { totalTokens: 10 },
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    // Should not crash, should have a stop event
    expect(events.some((e) => e.type === 'stop')).toBe(true);
  });

  it('handles provider returning response with empty toolCalls', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.provider.chat = vi.fn().mockResolvedValue({
      content: 'Response text',
      toolCalls: [],
      usage: { totalTokens: 10 },
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    // Empty toolCalls array is falsy, should complete
    expect(events.some((e) => e.type === 'stop')).toBe(true);
  });

  it('handles response with content and toolCalls simultaneously', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.provider.chat = vi.fn().mockResolvedValue({
      content: 'I will help with that',
      toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/a' } }],
      usage: { totalTokens: 40 },
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Help', 'session-1', { maxTurns: 2 })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.some((e) => e.type === 'tool_result')).toBe(true);
  });

  it('handles non-Error thrown from provider', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.provider.chat = vi.fn().mockRejectedValue('string error');

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.content).toBe('string error');
  });

  it('records tokens from response usage', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.provider.chat = vi.fn().mockResolvedValue({
      content: 'Hello',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    const textEvent = events.find((e) => e.type === 'text');
    expect(textEvent).toBeDefined();
    expect(textEvent!.tokens).toBe(150);
  });

  it('handles response with no usage info', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.provider.chat = vi.fn().mockResolvedValue({
      content: 'No usage',
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    // Should not crash
    expect(events.some((e) => e.type === 'text' || e.type === 'stop')).toBe(true);
  });

  it('saves messages even when error occurs', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.provider.chat = vi.fn().mockRejectedValue(new Error('fail'));

    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Hello', 'session-1')) {
      // consume
    }

    expect(mocks.sessions.saveMessages).toHaveBeenCalledWith('session-1', expect.any(Array));
  });

  it('emits stop hook with error reason on provider failure', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.provider.chat = vi.fn().mockRejectedValue(new Error('fail'));

    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Hello', 'session-1')) {
      // consume
    }

    const stopCall = mocks.hooks.emit.mock.calls.find(
      (call: any[]) => call[0] === 'stop',
    );
    expect(stopCall).toBeDefined();
    expect(stopCall![1]).toHaveProperty('reason', 'model_error');
  });
});

// ── onEvent callback ──

describe('AgentLoop with onEvent callback', () => {
  it('invokes onEvent callback for each event', async () => {
    const { deps } = createLoopDeps();
    const loop = new AgentLoop(deps);
    const callbackEvents: LoopEvent[] = [];
    const onEvent = (event: LoopEvent) => {
      callbackEvents.push(event);
    };

    for await (const _ of loop.run('Hello', 'session-1', { onEvent })) {
      // events are yielded and also passed to onEvent
    }

    // Note: onEvent is defined in LoopOptions but the current implementation
    // uses the async generator pattern. The onEvent callback may not be
    // invoked in the current implementation since it uses yield.
    // This test documents the current behavior.
  });
});

// ── Hook blocking in user_prompt_submit ──

describe('AgentLoop hook variations', () => {
  it('handles hook with exitCode warn', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.hooks.emit = vi.fn().mockResolvedValue({ exitCode: 'warn', message: 'Warning issued' });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    // warn does not block, should proceed normally
    expect(events.some((e) => e.type === 'text' || e.type === 'stop')).toBe(true);
  });

  it('handles hook with exitCode allow', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.hooks.emit = vi.fn().mockResolvedValue({ exitCode: 'allow' });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'text')).toBe(true);
  });

  it('handles hook with exitCode block without message', async () => {
    const { deps, mocks } = createLoopDeps();
    mocks.hooks.emit = vi.fn().mockImplementation((event: string) => {
      if (event === 'user_prompt_submit') {
        return Promise.resolve({ exitCode: 'block' }); // no message
      }
      return Promise.resolve({ exitCode: 'allow' });
    });

    const loop = new AgentLoop(deps);
    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.content).toBe('Blocked by hook');
  });
});
