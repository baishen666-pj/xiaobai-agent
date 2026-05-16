import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiter } from '../../src/provider/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ maxTokens: 5, refillRate: 10 });
  });

  it('starts with full bucket', () => {
    expect(limiter.getAvailableTokens('anthropic')).toBe(5);
  });

  it('acquire succeeds when tokens available', () => {
    expect(limiter.acquire('anthropic')).toBe(true);
    expect(limiter.getAvailableTokens('anthropic')).toBeCloseTo(4, 1);
  });

  it('acquire fails when no tokens', () => {
    for (let i = 0; i < 5; i++) limiter.acquire('anthropic');
    expect(limiter.acquire('anthropic')).toBe(false);
  });

  it('tokens refill over time', () => {
    for (let i = 0; i < 5; i++) limiter.acquire('anthropic');
    expect(limiter.getAvailableTokens('anthropic')).toBeCloseTo(0, 1);

    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    expect(limiter.getAvailableTokens('anthropic')).toBeCloseTo(1, 0);
    vi.useRealTimers();
  });

  it('per-provider isolation', () => {
    for (let i = 0; i < 5; i++) limiter.acquire('anthropic');
    expect(limiter.acquire('anthropic')).toBe(false);
    expect(limiter.acquire('openai')).toBe(true);
  });

  it('global mode shares bucket', () => {
    const global = new RateLimiter({ maxTokens: 3, refillRate: 1, perProvider: false });
    global.acquire('anthropic');
    global.acquire('openai');
    expect(global.getAvailableTokens('anthropic')).toBeCloseTo(1, 0);
  });

  it('acquireOrWait waits for tokens', async () => {
    for (let i = 0; i < 5; i++) limiter.acquire('anthropic');
    const start = Date.now();

    vi.useFakeTimers();
    const promise = limiter.acquireOrWait('anthropic', 1, 5000);
    vi.advanceTimersByTime(200);
    const result = await promise;
    vi.useRealTimers();

    expect(result).toBe(true);
  });

  it('acquireOrWait times out', async () => {
    for (let i = 0; i < 5; i++) limiter.acquire('anthropic');

    const result = await limiter.acquireOrWait('anthropic', 10, 50);
    expect(result).toBe(false);
  });

  it('reset clears provider bucket', () => {
    for (let i = 0; i < 5; i++) limiter.acquire('anthropic');
    limiter.reset('anthropic');
    expect(limiter.getAvailableTokens('anthropic')).toBe(5);
  });

  it('reset without args clears all buckets', () => {
    limiter.acquire('anthropic');
    limiter.acquire('openai');
    limiter.reset();
    expect(limiter.getAvailableTokens('anthropic')).toBe(5);
    expect(limiter.getAvailableTokens('openai')).toBe(5);
  });

  it('multi-token acquire', () => {
    expect(limiter.acquire('anthropic', 3)).toBe(true);
    expect(limiter.getAvailableTokens('anthropic')).toBeCloseTo(2, 0);
  });

  it('multi-token acquire fails when insufficient', () => {
    limiter.acquire('anthropic', 4);
    expect(limiter.acquire('anthropic', 2)).toBe(false);
  });
});
