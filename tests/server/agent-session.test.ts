import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSession } from '../../src/server/agent-session.js';
import type { AgentDeps } from '../../src/core/agent.js';
import type { LoopEvent } from '../../src/core/loop.js';
import type { ClientMessage } from '../../src/server/client-messages.js';

function createMockDeps(): AgentDeps {
  const sessions = {
    createSession: vi.fn(() => 'session_1234_abcd1234'),
    loadSessionState: vi.fn(() => Promise.resolve(null)),
    saveSessionState: vi.fn(() => Promise.resolve()),
    loadMessages: vi.fn(() => Promise.resolve([])),
    saveMessages: vi.fn(() => Promise.resolve()),
    listSessions: vi.fn(() => Promise.resolve([
      { id: 'session_1234_abcd1234', createdAt: 1000, updatedAt: 2000, messageCount: 5, totalTokens: 100 },
    ])),
    deleteSession: vi.fn(() => Promise.resolve(true)),
  };

  return {
    config: { get: vi.fn(() => ({ provider: { default: 'openai' }, model: { default: 'gpt-4' } })) } as any,
    provider: {
      chat: vi.fn(() => Promise.resolve({ content: 'hi', usage: { totalTokens: 10 } })),
      chatStream: vi.fn(),
      updateConfig: vi.fn(),
      getToolDefinitions: vi.fn(() => []),
    } as any,
    tools: { execute: vi.fn(() => Promise.resolve({ output: 'ok', success: true })) } as any,
    sessions: sessions as any,
    hooks: { emit: vi.fn(() => ({ exitCode: 'allow' })) } as any,
    memory: { getSystemPromptBlock: vi.fn(() => ''), flushIfDirty: vi.fn(() => Promise.resolve()) } as any,
    security: { checkPermission: vi.fn(() => Promise.resolve(true)) } as any,
  };
}

describe('AgentSession', () => {
  let deps: AgentDeps;
  let events: LoopEvent[];
  let onEvent: (event: LoopEvent) => void;

  beforeEach(() => {
    deps = createMockDeps();
    events = [];
    onEvent = vi.fn((e: LoopEvent) => events.push(e));
  });

  function createSession(sessionId = 'session_1234_abcd1234'): AgentSession {
    return new AgentSession(deps, sessionId, onEvent);
  }

  describe('handleSessionList', () => {
    it('returns session list from deps', async () => {
      const session = createSession();
      const result = await session.handleClientMessage({ type: 'session_list' });
      expect(result?.type).toBe('session_list_result');
      if (result?.type === 'session_list_result') {
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0].id).toBe('session_1234_abcd1234');
      }
    });
  });

  describe('handleSessionCreate', () => {
    it('creates new session and returns id', async () => {
      const session = createSession();
      const result = await session.handleClientMessage({ type: 'session_create' });
      expect(result?.type).toBe('session_created');
      if (result?.type === 'session_created') {
        expect(result.sessionId).toBe('session_1234_abcd1234');
      }
    });
  });

  describe('handleModelSelect', () => {
    it('returns model_changed ack', async () => {
      const session = createSession();
      const result = await session.handleClientMessage({
        type: 'model_select',
        provider: 'anthropic',
        model: 'claude-3',
      });
      expect(result?.type).toBe('model_changed');
      if (result?.type === 'model_changed') {
        expect(result.provider).toBe('anthropic');
        expect(result.model).toBe('claude-3');
      }
    });
  });

  describe('handleTaskCancel', () => {
    it('returns error when not running', async () => {
      const session = createSession();
      const result = await session.handleClientMessage({
        type: 'task_cancel',
        sessionId: 'session_1234_abcd1234',
      });
      expect(result?.type).toBe('ack');
      if (result?.type === 'ack') {
        expect(result.ok).toBe(false);
        expect(result.error).toContain('No active task');
      }
    });
  });

  describe('handleChatSend when not running', () => {
    it('returns ack ok', async () => {
      const session = createSession();
      const result = await session.handleClientMessage({
        type: 'chat_send',
        sessionId: 'session_1234_abcd1234',
        content: 'hello',
      });
      expect(result?.type).toBe('ack');
      if (result?.type === 'ack') {
        expect(result.ok).toBe(true);
      }
    });
  });

  describe('handleSessionResume', () => {
    it('returns ack ok when session exists', async () => {
      (deps.sessions.loadSessionState as any).mockResolvedValue({
        sessionId: 'session_1234_abcd1234',
        messages: [],
        turn: 0,
        totalTokens: 0,
      });
      const session = createSession();
      const result = await session.handleClientMessage({
        type: 'session_resume',
        sessionId: 'session_1234_abcd1234',
      });
      expect(result?.type).toBe('ack');
      if (result?.type === 'ack') {
        expect(result.ok).toBe(true);
      }
    });

    it('returns error when session not found', async () => {
      (deps.sessions.loadSessionState as any).mockResolvedValue(null);
      const session = createSession();
      const result = await session.handleClientMessage({
        type: 'session_resume',
        sessionId: 'session_1234_abcd1234',
      });
      expect(result?.type).toBe('ack');
      if (result?.type === 'ack') {
        expect(result.ok).toBe(false);
      }
    });
  });

  describe('handleTaskStart', () => {
    it('creates session and returns session_created', async () => {
      const session = createSession();
      const result = await session.handleClientMessage({
        type: 'task_start',
        prompt: 'build something',
      });
      expect(result?.type).toBe('session_created');
      if (result?.type === 'session_created') {
        expect(result.sessionId).toBe('session_1234_abcd1234');
      }
    });
  });

  describe('destroy', () => {
    it('stops the session', () => {
      const session = createSession();
      session.destroy();
      expect(session.isRunning()).toBe(false);
    });
  });

  describe('getSessionId', () => {
    it('returns the session id', () => {
      const session = createSession('session_1234_abcd1234');
      expect(session.getSessionId()).toBe('session_1234_abcd1234');
    });
  });
});
