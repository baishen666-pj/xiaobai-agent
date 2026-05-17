import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GracefulShutdown, type Shutdownable } from '../../src/server/graceful.js';

function createMockComponent(name: string, stopMs = 0): Shutdownable & { stopped: boolean } {
  return {
    name,
    stopped: false,
    stop: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, stopMs));
      (this as any).stopped = true;
    }),
  };
}

describe('GracefulShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should stop all registered components in order', async () => {
    const shutdown = new GracefulShutdown(5000);
    const order: string[] = [];

    const c1: Shutdownable = { name: 'c1', stop: vi.fn(async () => { order.push('c1'); }) };
    const c2: Shutdownable = { name: 'c2', stop: vi.fn(async () => { order.push('c2'); }) };

    shutdown.register(c1);
    shutdown.register(c2);

    await shutdown.shutdown('test');

    expect(order).toEqual(['c1', 'c2']);
    expect(c1.stop).toHaveBeenCalled();
    expect(c2.stop).toHaveBeenCalled();
  });

  it('should prevent double shutdown', async () => {
    const shutdown = new GracefulShutdown(5000);
    let stopCount = 0;
    const c: Shutdownable = { name: 'test', stop: vi.fn(async () => { stopCount++; }) };

    shutdown.register(c);
    await shutdown.shutdown('first');
    await shutdown.shutdown('second');

    expect(stopCount).toBe(1);
  });

  it('should force exit on timeout', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const shutdown = new GracefulShutdown(100);
    let resolveStop: () => void;
    const slow: Shutdownable = {
      name: 'slow',
      stop: () => new Promise<void>((r) => { resolveStop = r; }),
    };

    shutdown.register(slow);

    const shutdownPromise = shutdown.shutdown('timeout-test');
    await vi.advanceTimersByTimeAsync(200);

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    (resolveStop!)();
    await shutdownPromise;
  });

  it('should continue stopping other components if one fails', async () => {
    const shutdown = new GracefulShutdown(5000);
    const order: string[] = [];

    const fail: Shutdownable = {
      name: 'fail',
      stop: vi.fn(async () => { throw new Error('boom'); }),
    };
    const ok: Shutdownable = {
      name: 'ok',
      stop: vi.fn(async () => { order.push('ok'); }),
    };

    shutdown.register(fail);
    shutdown.register(ok);

    await shutdown.shutdown('test');

    expect(ok.stop).toHaveBeenCalled();
    expect(order).toEqual(['ok']);
  });

  it('should install and return cleanup function for signal handlers', () => {
    const shutdown = new GracefulShutdown();
    const cleanup = shutdown.install();

    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('should report shutting down state', async () => {
    const shutdown = new GracefulShutdown(5000);
    expect(shutdown.isShuttingDown()).toBe(false);

    const p = shutdown.shutdown('test');
    expect(shutdown.isShuttingDown()).toBe(true);
    await p;
  });
});
