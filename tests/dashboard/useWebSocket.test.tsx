// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../../src/dashboard/hooks/useWebSocket.js';

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  static instances: MockWebSocket[] = [];
  static last: MockWebSocket | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    MockWebSocket.last = this;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(_data: string) {}

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.last = null;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    MockWebSocket.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:8080'));
    const s = result.current;
    expect(s.connected).toBe(false);
    expect(s.events).toEqual([]);
    expect(s.agents).toEqual([]);
    expect(s.tasks).toEqual([]);
    expect(s.tokenTotal).toBe(0);
    expect(s.chatMessages).toEqual([]);
    expect(s.chatTokenTotal).toBe(0);
    expect(s.eventFilter).toBe('all');
    expect(s.tokenHistory).toEqual([]);
    expect(s.progressEvents).toEqual({});
  });

  it('exposes connect and disconnect functions', () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:8080'));
    expect(typeof result.current.connect).toBe('function');
    expect(typeof result.current.disconnect).toBe('function');
    expect(typeof result.current.setEventFilter).toBe('function');
  });

  describe('connect', () => {
    it('creates WebSocket with provided url', async () => {
      const { result } = renderHook(() => useWebSocket('ws://test:1234'));
      act(() => { result.current.connect(); });
      await act(flush);
      expect(MockWebSocket.last?.url).toBe('ws://test:1234');
    });

    it('sets connected to true on open', async () => {
      const { result } = renderHook(() => useWebSocket('ws://test'));
      act(() => { result.current.connect(); });
      await act(flush);
      expect(result.current.connected).toBe(true);
    });

    it('adds connected event on open', async () => {
      const { result } = renderHook(() => useWebSocket('ws://test'));
      act(() => { result.current.connect(); });
      await act(flush);
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].type).toBe('connected');
    });

    it('closes existing connection before reconnecting', async () => {
      const { result } = renderHook(() => useWebSocket('ws://test'));
      act(() => { result.current.connect(); });
      await act(flush);
      const first = MockWebSocket.last!;
      const closeSpy = vi.spyOn(first, 'close');
      act(() => { result.current.connect(); });
      await act(flush);
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('sets connected to false', async () => {
      const { result } = renderHook(() => useWebSocket('ws://test'));
      act(() => { result.current.connect(); });
      await act(flush);
      act(() => { result.current.disconnect(); });
      await act(flush);
      expect(result.current.connected).toBe(false);
    });

    it('adds disconnected event', async () => {
      const { result } = renderHook(() => useWebSocket('ws://test'));
      act(() => { result.current.connect(); });
      await act(flush);
      act(() => { result.current.disconnect(); });
      await act(flush);
      const types = result.current.events.map((e) => e.type);
      expect(types).toContain('disconnected');
    });
  });

  describe('message handling', () => {
    async function connectAndGet(hook: ReturnType<typeof renderHook>) {
      act(() => { hook.result.current.connect(); });
      await act(flush);
      return MockWebSocket.last!;
    }

    it('handles "plan" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({
          type: 'plan',
          tasks: [
            { id: 't1', description: 'Task 1', role: 'coder', status: 'pending' },
            { id: 't2', description: 'Task 2', role: 'tester', status: 'pending', priority: 'high' },
          ],
        });
      });
      const s = hook.result.current;
      expect(s.tasks).toHaveLength(2);
      expect(s.tasks[0]).toEqual(expect.objectContaining({ id: 't1', role: 'coder', status: 'pending' }));
      expect(s.tasks[1]).toEqual(expect.objectContaining({ id: 't2', priority: 'high' }));
    });

    it('handles "task_started" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'plan', tasks: [{ id: 't1', description: 'Do stuff', role: 'coder', status: 'pending' }] });
      });
      act(() => {
        ws.simulateMessage({ type: 'task_started', agentId: 'a1', task: { id: 't1', role: 'coder', description: 'Do stuff' } });
      });
      const s = hook.result.current;
      expect(s.tasks[0].status).toBe('running');
      expect(s.agents).toHaveLength(1);
      expect(s.agents[0]).toEqual(expect.objectContaining({ id: 'a1', busy: true, currentTask: 't1' }));
    });

    it('handles "task_progress" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'task_progress', task: { id: 't1' }, event: { content: 'Working on it...' } });
      });
      expect(hook.result.current.progressEvents['t1']).toEqual(['Working on it...']);
    });

    it('handles "task_completed" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'plan', tasks: [{ id: 't1', description: 'Task', role: 'coder', status: 'running' }] });
        ws.simulateMessage({ type: 'task_started', agentId: 'a1', task: { id: 't1', role: 'coder' } });
      });
      act(() => {
        ws.simulateMessage({ type: 'task_completed', task: { id: 't1', role: 'coder' }, result: { tokensUsed: 500 } });
      });
      const s = hook.result.current;
      expect(s.tasks[0].status).toBe('completed');
      expect(s.tasks[0].tokensUsed).toBe(500);
      expect(s.tokenTotal).toBe(500);
      expect(s.tokenHistory).toHaveLength(1);
      expect(s.tokenHistory[0].tokens).toBe(500);
      expect(s.agents[0].busy).toBe(false);
    });

    it('handles "task_failed" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'plan', tasks: [{ id: 't1', description: 'Task', role: 'coder', status: 'running' }] });
        ws.simulateMessage({ type: 'task_started', agentId: 'a1', task: { id: 't1', role: 'coder' } });
      });
      act(() => {
        ws.simulateMessage({ type: 'task_failed', task: { id: 't1' }, error: 'Out of memory' });
      });
      const s = hook.result.current;
      expect(s.tasks[0].status).toBe('failed');
      expect(s.agents[0].busy).toBe(false);
    });

    it('handles "all_completed" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => { ws.simulateMessage({ type: 'all_completed' }); });
      const types = hook.result.current.events.map((e) => e.type);
      expect(types).toContain('all_completed');
    });

    it('handles "agent_status" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({
          type: 'agent_status',
          agents: [
            { id: 'a1', role: 'coder', busy: true, currentTask: 't1', cost: 0.5 },
            { id: 'a2', role: 'reviewer', busy: false },
          ],
        });
      });
      expect(hook.result.current.agents).toHaveLength(2);
      expect(hook.result.current.agents[0]).toEqual(expect.objectContaining({ id: 'a1', cost: 0.5 }));
    });

    it('handles "chat_start" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'chat_start', sessionId: 's1', prompt: 'Hello', timestamp: 1000 });
      });
      const msgs = hook.result.current.chatMessages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].type).toBe('user');
      expect(msgs[0].sessionId).toBe('s1');
      expect(msgs[0].content).toBe('Hello');
    });

    it('handles "chat_turn" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'chat_turn', sessionId: 's1', content: 'Response text', tokens: 50 });
      });
      const s = hook.result.current;
      expect(s.chatMessages).toHaveLength(1);
      expect(s.chatMessages[0].type).toBe('assistant');
      expect(s.chatMessages[0].tokens).toBe(50);
      expect(s.chatTokenTotal).toBe(50);
    });

    it('handles "chat_tool_call" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'chat_tool_call', sessionId: 's1', toolName: 'bash' });
      });
      expect(hook.result.current.chatMessages[0].type).toBe('tool_call');
      expect(hook.result.current.chatMessages[0].toolName).toBe('bash');
    });

    it('handles "chat_tool_result" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'chat_tool_result', sessionId: 's1', output: 'ok', toolName: 'bash', success: true });
      });
      const msg = hook.result.current.chatMessages[0];
      expect(msg.type).toBe('tool_result');
      expect(msg.success).toBe(true);
      expect(msg.toolName).toBe('bash');
    });

    it('handles "chat_stop" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'chat_stop', reason: 'done' });
      });
      const types = hook.result.current.events.map((e) => e.type);
      expect(types).toContain('chat_stop');
    });

    it('handles "chat_error" message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'chat_error', sessionId: 's1', error: 'Timeout' });
      });
      const msg = hook.result.current.chatMessages[0];
      expect(msg.type).toBe('error');
      expect(msg.content).toBe('Timeout');
    });

    it('handles invalid JSON message', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.onmessage?.({ data: 'not json' });
      });
      const errEvents = hook.result.current.events.filter((e) => e.type === 'error');
      expect(errEvents.length).toBeGreaterThanOrEqual(1);
      expect(errEvents[0].message).toContain('Invalid message');
    });

    it('ignores unknown message type', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      const ws = await connectAndGet(hook);
      act(() => {
        ws.simulateMessage({ type: 'unknown_event', data: 'whatever' });
      });
      expect(hook.result.current.events).toHaveLength(1);
    });
  });

  describe('event buffer limits', () => {
    it('keeps at most 200 events', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      act(() => { hook.result.current.connect(); });
      await act(flush);
      const ws = MockWebSocket.last!;
      for (let i = 0; i < 250; i++) {
        act(() => { ws.simulateMessage({ type: 'all_completed' }); });
      }
      expect(hook.result.current.events.length).toBeLessThanOrEqual(200);
    });

    it('keeps at most 100 chat messages', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      act(() => { hook.result.current.connect(); });
      await act(flush);
      const ws = MockWebSocket.last!;
      for (let i = 0; i < 150; i++) {
        act(() => { ws.simulateMessage({ type: 'chat_turn', sessionId: 's1', content: `msg${i}`, tokens: 1 }); });
      }
      expect(hook.result.current.chatMessages.length).toBeLessThanOrEqual(100);
    });

    it('keeps at most 200 token history entries', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      act(() => { hook.result.current.connect(); });
      await act(flush);
      const ws = MockWebSocket.last!;
      for (let i = 0; i < 250; i++) {
        act(() => {
          ws.simulateMessage({ type: 'task_completed', task: { id: `t${i}`, role: 'coder' }, result: { tokensUsed: 10 } });
        });
      }
      expect(hook.result.current.tokenHistory.length).toBeLessThanOrEqual(200);
    });
  });

  describe('upsertAgent', () => {
    it('updates existing agent on task_started', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      act(() => { hook.result.current.connect(); });
      await act(flush);
      const ws = MockWebSocket.last!;
      act(() => {
        ws.simulateMessage({ type: 'task_started', agentId: 'a1', task: { id: 't1', role: 'coder', description: 'First' } });
      });
      act(() => {
        ws.simulateMessage({ type: 'task_started', agentId: 'a1', task: { id: 't2', role: 'coder', description: 'Second' } });
      });
      expect(hook.result.current.agents).toHaveLength(1);
      expect(hook.result.current.agents[0].currentTask).toBe('t2');
    });
  });

  describe('reconnection', () => {
    it('attempts to reconnect on close', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      act(() => { hook.result.current.connect(); });
      await act(flush);
      const ws = MockWebSocket.last!;
      act(() => { ws.close(); });
      act(() => { vi.advanceTimersByTime(2000); });
      await act(flush);
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    });

    it('does not reconnect after disconnect', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      act(() => { hook.result.current.connect(); });
      await act(flush);
      const countBefore = MockWebSocket.instances.length;
      act(() => { hook.result.current.disconnect(); });
      act(() => { vi.advanceTimersByTime(60_000); });
      await act(flush);
      expect(MockWebSocket.instances.length).toBe(countBefore);
    });

    it('uses exponential backoff with max 30s', async () => {
      const hook = renderHook(() => useWebSocket('ws://test'));
      act(() => { hook.result.current.connect(); });
      await act(flush);
      for (let i = 0; i < 10; i++) {
        MockWebSocket.reset();
        act(() => { MockWebSocket.last?.close(); });
      }
      act(() => { vi.advanceTimersByTime(30000); });
      await act(flush);
    });
  });

  describe('setEventFilter', () => {
    it('updates event filter', () => {
      const { result } = renderHook(() => useWebSocket('ws://test'));
      act(() => { result.current.setEventFilter('error'); });
      expect(result.current.eventFilter).toBe('error');
    });
  });

  describe('cleanup', () => {
    it('cleans up on unmount', async () => {
      const { result, unmount } = renderHook(() => useWebSocket('ws://test'));
      act(() => { result.current.connect(); });
      await act(flush);
      const ws = MockWebSocket.last!;
      const closeSpy = vi.spyOn(ws, 'close');
      unmount();
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('invalid URL', () => {
    it('handles invalid WebSocket URL gracefully', async () => {
      const { result } = renderHook(() => useWebSocket('bad-url'));
      act(() => { result.current.connect(); });
      act(() => { result.current.disconnect(); });
      await act(flush);
      act(() => {
        vi.stubGlobal('WebSocket', class {
          static OPEN = 1;
          constructor() { throw new Error('Invalid URL'); }
        });
      });
      act(() => { result.current.connect(); });
      const errEvents = result.current.events.filter((e) => e.type === 'error');
      expect(errEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('onerror', () => {
    it('adds error event on connection error', async () => {
      const { result } = renderHook(() => useWebSocket('ws://test'));
      act(() => { result.current.connect(); });
      await act(flush);
      act(() => { MockWebSocket.last!.onerror?.(); });
      const errEvents = result.current.events.filter((e) => e.type === 'error');
      expect(errEvents).toHaveLength(1);
      expect(errEvents[0].message).toBe('Connection error');
    });
  });
});
