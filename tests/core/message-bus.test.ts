import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageBus, type BusMessage } from '../../src/core/message-bus.js';

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus({ maxHistory: 50 });
  });

  describe('send (point-to-point)', () => {
    it('delivers a message to a specific agent', () => {
      const handler = vi.fn();
      bus.subscribe('agent-b', 'direct', handler);

      const msg = bus.send('agent-a', 'agent-b', 'task', { action: 'analyze' });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'agent-a',
          to: 'agent-b',
          type: 'task',
          payload: { action: 'analyze' },
        }),
      );
      expect(msg.id).toBeTruthy();
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('does not deliver to other agents', () => {
      const handlerB = vi.fn();
      const handlerC = vi.fn();
      bus.subscribe('agent-b', 'direct', handlerB);
      bus.subscribe('agent-c', 'direct', handlerC);

      bus.send('agent-a', 'agent-b', 'task', {});

      expect(handlerB).toHaveBeenCalledOnce();
      expect(handlerC).not.toHaveBeenCalled();
    });

    it('records message in history', () => {
      bus.send('a', 'b', 'test', { x: 1 });
      const history = bus.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe('test');
    });
  });

  describe('broadcast', () => {
    it('delivers to all subscribers with wildcard pattern', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      bus.subscribe('agent-a', '*', handlerA);
      bus.subscribe('agent-b', '*', handlerB);

      const msg = bus.broadcast('coordinator', 'status', { status: 'running' });

      expect(handlerA).toHaveBeenCalledWith(expect.objectContaining({ type: 'status' }));
      expect(handlerB).toHaveBeenCalledWith(expect.objectContaining({ type: 'status' }));
      expect(msg.to).toBeUndefined();
    });

    it('does not set a "to" field', () => {
      const msg = bus.broadcast('coordinator', 'heartbeat', {});
      expect(msg.to).toBeUndefined();
    });
  });

  describe('request-response', () => {
    it('resolves when a reply is received', async () => {
      bus.subscribe('worker', 'direct', (msg) => {
        if (msg.type === 'query') {
          bus.reply(msg, 'worker', { result: 42 });
        }
      });

      const response = await bus.request('coordinator', 'worker', 'query', { q: 'meaning of life' });

      expect(response.payload).toEqual({ result: 42 });
      expect(response.type).toBe('query:reply');
      expect(response.correlationId).toBeTruthy();
    });

    it('rejects on timeout', async () => {
      bus.subscribe('worker', 'direct', () => {
        // No reply
      });

      await expect(
        bus.request('coordinator', 'worker', 'query', {}, 100),
      ).rejects.toThrow('timed out');
    });

    it('uses default timeout when not specified', async () => {
      const shortBus = new MessageBus({ defaultTimeout: 50 });
      shortBus.subscribe('worker', 'direct', () => {});

      await expect(
        shortBus.request('coordinator', 'worker', 'ping', {}),
      ).rejects.toThrow('timed out');

      shortBus.clear();
    });
  });

  describe('subscribe', () => {
    it('unsubscribes when cleanup function is called', () => {
      const handler = vi.fn();
      const unsub = bus.subscribe('agent-a', '*', handler);

      bus.send('agent-b', 'agent-a', 'test', {});
      expect(handler).toHaveBeenCalledOnce();

      unsub();

      bus.send('agent-b', 'agent-a', 'test', {});
      expect(handler).toHaveBeenCalledOnce();
    });

    it('filters by type pattern', () => {
      const handler = vi.fn();
      bus.subscribe('agent-a', 'type:task', handler);

      bus.send('agent-b', 'agent-a', 'task', {});
      bus.send('agent-b', 'agent-a', 'status', {});

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'task' }));
    });

    it('wildcard receives broadcasts', () => {
      const handler = vi.fn();
      bus.subscribe('agent-a', '*', handler);

      bus.broadcast('coordinator', 'announcement', { msg: 'hello' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'announcement' }),
      );
    });
  });

  describe('getHistory', () => {
    it('filters by type', () => {
      bus.send('a', 'b', 'task', {});
      bus.send('a', 'b', 'status', {});
      bus.send('a', 'b', 'task', {});

      const tasks = bus.getHistory({ type: 'task' });
      expect(tasks).toHaveLength(2);
    });

    it('filters by from', () => {
      bus.send('a', 'b', 'test', {});
      bus.send('c', 'b', 'test', {});

      const fromA = bus.getHistory({ from: 'a' });
      expect(fromA).toHaveLength(1);
      expect(fromA[0].from).toBe('a');
    });

    it('filters by to', () => {
      bus.send('a', 'b', 'test', {});
      bus.send('a', 'c', 'test', {});

      const toB = bus.getHistory({ to: 'b' });
      expect(toB).toHaveLength(1);
      expect(toB[0].to).toBe('b');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        bus.send('a', 'b', 'test', { i });
      }

      const recent = bus.getHistory({ limit: 3 });
      expect(recent).toHaveLength(3);
      expect(recent[2].payload).toEqual({ i: 9 });
    });

    it('trims history when exceeding maxHistory', () => {
      const smallBus = new MessageBus({ maxHistory: 5 });
      for (let i = 0; i < 10; i++) {
        smallBus.send('a', 'b', 'test', { i });
      }

      const history = smallBus.getHistory();
      expect(history).toHaveLength(5);
      expect(history[0].payload).toEqual({ i: 5 });

      smallBus.clear();
    });
  });

  describe('clear', () => {
    it('clears all state', async () => {
      const handler = vi.fn();
      bus.subscribe('a', '*', handler);
      bus.send('a', 'b', 'test', {});

      const pendingPromise = bus.request('a', 'b', 'query', {}, 5000);
      pendingPromise.catch(() => {});

      expect(bus.getSubscriptionCount()).toBe(1);
      expect(bus.getPendingCount()).toBe(1);

      bus.clear();

      await expect(pendingPromise).rejects.toThrow('Bus cleared');

      expect(bus.getHistory()).toHaveLength(0);
      expect(bus.getSubscriptionCount()).toBe(0);
      expect(bus.getPendingCount()).toBe(0);
    });
  });

  describe('reply', () => {
    it('can be sent without a pending request', () => {
      const handler = vi.fn();
      bus.subscribe('agent-a', '*', handler);

      const original: BusMessage = {
        id: 'msg_x',
        from: 'agent-a',
        to: 'agent-b',
        type: 'task',
        payload: {},
        timestamp: Date.now(),
        correlationId: 'req_1',
      };

      const reply = bus.reply(original, 'agent-b', { done: true });

      expect(reply.type).toBe('task:reply');
      expect(reply.to).toBe('agent-a');
      expect(reply.from).toBe('agent-b');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'task:reply' }),
      );
    });
  });

  describe('getPendingCount / getSubscriptionCount', () => {
    it('tracks pending requests', () => {
      expect(bus.getPendingCount()).toBe(0);
      bus.subscribe('b', 'direct', () => {});
      bus.request('a', 'b', 'query', {}, 5000);
      expect(bus.getPendingCount()).toBe(1);
    });

    it('tracks subscriptions', () => {
      expect(bus.getSubscriptionCount()).toBe(0);
      bus.subscribe('a', '*', () => {});
      expect(bus.getSubscriptionCount()).toBe(1);
    });
  });
});
