import { describe, it, expect, beforeEach } from 'vitest';
import { ReconnectionManager } from '../../src/mcp/reconnection.js';

describe('ReconnectionManager', () => {
  let manager: ReconnectionManager;

  beforeEach(() => {
    manager = new ReconnectionManager({ maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });
  });

  it('returns true on first successful attempt', async () => {
    const result = await manager.attempt(async () => true);
    expect(result).toBe(true);
    expect(manager.getAttemptCount()).toBe(0);
  });

  it('retries on failure and succeeds', async () => {
    let calls = 0;
    const result = await manager.attempt(async () => {
      calls++;
      return calls >= 2;
    });
    expect(result).toBe(true);
    expect(calls).toBe(2);
  });

  it('returns false after max retries', async () => {
    let calls = 0;
    const result = await manager.attempt(async () => {
      calls++;
      return false;
    });
    expect(result).toBe(false);
    expect(calls).toBe(3);
  });

  it('returns false when callback throws', async () => {
    const result = await manager.attempt(async () => {
      throw new Error('fail');
    });
    expect(result).toBe(false);
    expect(manager.getAttemptCount()).toBe(3);
  });

  it('resets attempt count', async () => {
    await manager.attempt(async () => false);
    expect(manager.getAttemptCount()).toBe(3);
    manager.reset();
    expect(manager.getAttemptCount()).toBe(0);
  });

  it('exposes max retries', () => {
    expect(manager.getMaxRetries()).toBe(3);
  });

  it('uses defaults when no config', () => {
    const defaultManager = new ReconnectionManager();
    expect(defaultManager.getMaxRetries()).toBe(5);
  });
});
