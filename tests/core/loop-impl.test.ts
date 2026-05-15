import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop, type LoopEvent } from '../../src/core/loop.js';
import type { ToolRegistry } from '../../src/tools/registry.js';
import type { ProviderRouter } from '../../src/provider/router.js';
import type { SessionManager } from '../../src/session/manager.js';
import type { HookSystem } from '../../src/hooks/system.js';
import type { ConfigManager } from '../../src/config/manager.js';
import type { MemorySystem } from '../../src/memory/system.js';
import type { SecurityManager } from '../../src/security/manager.js';

function createLoopDeps() {
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
    emit: vi.fn().mockResolvedValue({ exitCode: 'ok' }),
  } as unknown as HookSystem;

  const mockMemory = {
    getSystemPromptBlock: vi.fn().mockResolvedValue(null),
    flushIfDirty: vi.fn().mockResolvedValue(undefined),
  } as unknown as MemorySystem;

  const mockSecurity = {
    checkPermission: vi.fn().mockResolvedValue(true),
  } as unknown as SecurityManager;

  return {
    deps: {
      provider: mockProvider,
      tools: mockTools,
      sessions: mockSessions,
      hooks: mockHooks,
      config: mockConfig,
      memory: mockMemory,
      security: mockSecurity,
    },
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
      return Promise.resolve({ exitCode: 'ok' });
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
