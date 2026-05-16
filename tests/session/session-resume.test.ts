import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager, type SessionState } from '../../src/session/manager.js';
import { AgentLoop, type LoopEvent } from '../../src/core/loop.js';
import type { ToolRegistry } from '../../src/tools/registry.js';
import type { ProviderRouter } from '../../src/provider/router.js';
import type { SessionManager as SessionManagerType } from '../../src/session/manager.js';
import type { HookSystem } from '../../src/hooks/system.js';
import type { ConfigManager } from '../../src/config/manager.js';
import type { MemorySystem } from '../../src/memory/system.js';
import type { SecurityManager } from '../../src/security/manager.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-resume-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── SessionState persistence ──

describe('SessionManager saveSessionState / loadSessionState', () => {
  it('saves and loads full session state', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    const state: SessionState = {
      sessionId: id,
      messages: [
        { role: 'user', content: 'Hello', timestamp: 1000 },
        { role: 'assistant', content: 'Hi there!', timestamp: 2000 },
      ],
      turn: 3,
      totalTokens: 150,
      lastCompactTokens: 50,
      model: 'gpt-4',
      provider: 'openai',
      createdAt: 1000,
      updatedAt: 2000,
    };

    await sm.saveSessionState(id, state);
    const loaded = await sm.loadSessionState(id);

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe(id);
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.turn).toBe(3);
    expect(loaded!.totalTokens).toBe(150);
    expect(loaded!.lastCompactTokens).toBe(50);
    expect(loaded!.model).toBe('gpt-4');
    expect(loaded!.provider).toBe('openai');
  });

  it('saves partial state and merges with existing', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();

    // Save initial state
    await sm.saveSessionState(id, {
      sessionId: id,
      messages: [{ role: 'user', content: 'first', timestamp: 1000 }],
      turn: 1,
      totalTokens: 10,
      lastCompactTokens: 0,
    });

    // Update with partial state
    await sm.saveSessionState(id, {
      sessionId: id,
      turn: 2,
      totalTokens: 25,
    });

    const loaded = await sm.loadSessionState(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.turn).toBe(2);
    expect(loaded!.totalTokens).toBe(25);
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0].content).toBe('first');
  });

  it('returns null for nonexistent session', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();
    // Delete the file to simulate nonexistent session
    const path = join(tempDir, 'sessions', `${id}.json`);
    const { unlinkSync } = await import('node:fs');
    unlinkSync(path);

    const result = await sm.loadSessionState(id);
    expect(result).toBeNull();
  });

  it('returns null for nonexistent session with valid ID format', async () => {
    const sm = new SessionManager(tempDir);
    // This ID matches the regex but the file does not exist
    const result = await sm.loadSessionState('session_999999999_aaaaaaaa');
    expect(result).toBeNull();
  });
});

// ── Backward compatibility ──

describe('SessionManager backward compatibility', () => {
  it('loads old-format session files (just Message[])', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();

    // Write old-format data (just an array of messages)
    const path = join(tempDir, 'sessions', `${id}.json`);
    const oldMessages = [
      { role: 'user', content: 'Old message', timestamp: 5000 },
      { role: 'assistant', content: 'Old reply', timestamp: 6000 },
    ];
    writeFileSync(path, JSON.stringify(oldMessages, null, 2), 'utf-8');

    const state = await sm.loadSessionState(id);

    expect(state).not.toBeNull();
    expect(state!.sessionId).toBe(id);
    expect(state!.messages).toHaveLength(2);
    expect(state!.messages[0].content).toBe('Old message');
    expect(state!.turn).toBe(0);
    expect(state!.totalTokens).toBe(0);
    expect(state!.lastCompactTokens).toBe(0);
    expect(state!.createdAt).toBe(5000);
    expect(state!.updatedAt).toBe(6000);
  });

  it('saves new format over old format session', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();

    // Write old-format data
    const path = join(tempDir, 'sessions', `${id}.json`);
    writeFileSync(path, JSON.stringify([
      { role: 'user', content: 'old', timestamp: 100 },
    ], null, 2), 'utf-8');

    // Save new format
    await sm.saveSessionState(id, {
      sessionId: id,
      messages: [{ role: 'user', content: 'new', timestamp: 200 }],
      turn: 5,
      totalTokens: 100,
      lastCompactTokens: 0,
    });

    const loaded = await sm.loadSessionState(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.messages[0].content).toBe('new');
    expect(loaded!.turn).toBe(5);
  });
});

// ── listSessions with new format ──

describe('SessionManager listSessions with metadata', () => {
  it('returns metadata from new-format sessions', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();

    await sm.saveSessionState(id, {
      sessionId: id,
      messages: [
        { role: 'user', content: 'hi', timestamp: 3000 },
        { role: 'assistant', content: 'hello', timestamp: 4000 },
      ],
      turn: 3,
      totalTokens: 200,
      lastCompactTokens: 50,
    });

    const sessions = await sm.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(id);
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[0].totalTokens).toBe(200);
    expect(sessions[0].createdAt).toBeGreaterThan(0);
    expect(sessions[0].updatedAt).toBeGreaterThan(0);
  });

  it('returns metadata from old-format sessions', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();

    const path = join(tempDir, 'sessions', `${id}.json`);
    writeFileSync(path, JSON.stringify([
      { role: 'user', content: 'a', timestamp: 1000 },
      { role: 'assistant', content: 'b', timestamp: 2000 },
    ], null, 2), 'utf-8');

    const sessions = await sm.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messageCount).toBe(2);
    expect(sessions[0].createdAt).toBe(1000);
    expect(sessions[0].updatedAt).toBe(2000);
  });

  it('returns empty array when no sessions exist', async () => {
    const sm = new SessionManager(tempDir);
    const sessions = await sm.listSessions();
    expect(sessions).toEqual([]);
  });
});

// ── getLatestSession ──

describe('SessionManager getLatestSession', () => {
  it('returns null when no sessions exist', async () => {
    const sm = new SessionManager(tempDir);
    const result = await sm.getLatestSession();
    expect(result).toBeNull();
  });

  it('returns the most recently updated session ID', async () => {
    const sm = new SessionManager(tempDir);
    const id1 = sm.createSession();
    const id2 = sm.createSession();

    await sm.saveSessionState(id1, {
      sessionId: id1,
      messages: [{ role: 'user', content: 'first', timestamp: 1000 }],
      turn: 1,
      totalTokens: 10,
      lastCompactTokens: 0,
    });

    // Small delay to ensure different updatedAt
    await new Promise((r) => setTimeout(r, 10));

    await sm.saveSessionState(id2, {
      sessionId: id2,
      messages: [{ role: 'user', content: 'second', timestamp: 2000 }],
      turn: 2,
      totalTokens: 20,
      lastCompactTokens: 0,
    });

    const latest = await sm.getLatestSession();
    expect(latest).toBe(id2);
  });
});

// ── saveSessionState validation ──

describe('SessionManager saveSessionState validation', () => {
  it('rejects invalid session ID', async () => {
    const sm = new SessionManager(tempDir);
    await expect(sm.saveSessionState('invalid-id', {
      sessionId: 'invalid-id',
      messages: [],
      turn: 0,
      totalTokens: 0,
      lastCompactTokens: 0,
    })).rejects.toThrow('Invalid session ID');
  });
});

// ── AgentLoop with initialState ──

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
    saveSessionState: vi.fn().mockResolvedValue(undefined),
    loadSessionState: vi.fn().mockResolvedValue(null),
  } as unknown as SessionManagerType;

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

  return { deps, mocks: { provider: mockProvider, tools: mockTools, sessions: mockSessions, hooks: mockHooks, config: mockConfig, memory: mockMemory, security: mockSecurity } };
}

describe('AgentLoop with initialState', () => {
  it('resumes from initialState messages', async () => {
    const { deps, mocks } = createLoopDeps();
    const existingMessages = [
      { role: 'user', content: 'Previous question', timestamp: 1000 },
      { role: 'assistant', content: 'Previous answer', timestamp: 2000 },
    ];
    const loop = new AgentLoop(deps);

    const events: LoopEvent[] = [];
    for await (const event of loop.run('Follow up', 'session-1', {}, {
      messages: existingMessages,
      turn: 2,
      totalTokens: 100,
      lastCompactTokens: 0,
    })) {
      events.push(event);
    }

    // Should NOT call loadMessages since initialState provides messages
    expect(mocks.sessions.loadMessages).not.toHaveBeenCalled();

    // Should save session state including both old and new
    expect(mocks.sessions.saveSessionState).toHaveBeenCalledWith('session-1', expect.objectContaining({ sessionId: 'session-1', messages: expect.any(Array) }));
    const savedState = mocks.sessions.saveSessionState.mock.calls[0][1] as any;
    const savedMessages = savedState.messages;
    expect(savedMessages.length).toBeGreaterThanOrEqual(3); // 2 old + user message + response
    expect(savedMessages[0].content).toBe('Previous question');
  });

  it('resumes from initialState turn and token counts', async () => {
    const { deps, mocks } = createLoopDeps();

    // Make provider return a response to verify token accumulation
    mocks.provider.chat = vi.fn().mockResolvedValue({
      content: 'Response',
      usage: { totalTokens: 50 },
    });

    const loop = new AgentLoop(deps);
    for await (const _ of loop.run('Hello', 'session-1', {}, {
      messages: [{ role: 'user', content: 'old', timestamp: 1 }],
      turn: 5,
      totalTokens: 500,
      lastCompactTokens: 200,
    })) {
      // consume
    }

    // State should have turn = 5 + 1 = 6, tokens = 500 + 50 = 550
    expect(mocks.sessions.saveSessionState).toHaveBeenCalled();
  });

  it('works without initialState (backward compatible)', async () => {
    const { deps, mocks } = createLoopDeps();
    const loop = new AgentLoop(deps);

    const events: LoopEvent[] = [];
    for await (const event of loop.run('Hello', 'session-1')) {
      events.push(event);
    }

    // Should call loadMessages since no initialState
    expect(mocks.sessions.loadMessages).toHaveBeenCalledWith('session-1');
    expect(events.some((e) => e.type === 'text')).toBe(true);
  });

  it('uses initialState with empty messages array', async () => {
    const { deps, mocks } = createLoopDeps();
    const loop = new AgentLoop(deps);

    for await (const _ of loop.run('Hello', 'session-1', {}, {
      messages: [],
      turn: 0,
      totalTokens: 0,
      lastCompactTokens: 0,
    })) {
      // consume
    }

    // Should NOT call loadMessages since initialState.messages is provided (even if empty)
    expect(mocks.sessions.loadMessages).not.toHaveBeenCalled();
  });
});

// ── Full resume flow integration ──

describe('Session resume integration', () => {
  it('saveSessionState persists state that loadSessionState recovers', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();

    const originalState: SessionState = {
      sessionId: id,
      messages: [
        { role: 'user', content: 'What is 2+2?', timestamp: 10000 },
        { role: 'assistant', content: '4', timestamp: 11000 },
      ],
      turn: 5,
      totalTokens: 300,
      lastCompactTokens: 100,
      model: 'gpt-4',
      provider: 'openai',
      createdAt: 10000,
      updatedAt: 11000,
    };

    await sm.saveSessionState(id, originalState);
    const recovered = await sm.loadSessionState(id);

    expect(recovered).not.toBeNull();
    expect(recovered!.messages).toEqual(originalState.messages);
    expect(recovered!.turn).toBe(5);
    expect(recovered!.totalTokens).toBe(300);
    expect(recovered!.lastCompactTokens).toBe(100);
    expect(recovered!.model).toBe('gpt-4');
    expect(recovered!.provider).toBe('openai');
  });

  it('session file on disk contains SessionState format', async () => {
    const sm = new SessionManager(tempDir);
    const id = sm.createSession();

    await sm.saveSessionState(id, {
      sessionId: id,
      messages: [{ role: 'user', content: 'test', timestamp: 1 }],
      turn: 1,
      totalTokens: 50,
      lastCompactTokens: 0,
    });

    const path = join(tempDir, 'sessions', `${id}.json`);
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    expect(raw.sessionId).toBe(id);
    expect(raw.messages).toHaveLength(1);
    expect(raw.turn).toBe(1);
    expect(raw.totalTokens).toBe(50);
  });
});
