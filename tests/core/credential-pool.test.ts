import { describe, it, expect, beforeEach } from 'vitest';
import { CredentialPool } from '../../src/core/credential-pool.js';

describe('CredentialPool', () => {
  let pool: CredentialPool;

  beforeEach(() => {
    pool = new CredentialPool();
  });

  it('acquires a lease when keys are available', () => {
    pool.add('openai', 'sk-key1');
    const lease = pool.acquire('openai');
    expect(lease).not.toBeNull();
    expect(lease!.apiKey).toBe('sk-key1');
    expect(lease!.provider).toBe('openai');
  });

  it('returns null when no keys match provider', () => {
    pool.add('openai', 'sk-key1');
    const lease = pool.acquire('anthropic');
    expect(lease).toBeNull();
  });

  it('returns null when pool is empty', () => {
    const lease = pool.acquire();
    expect(lease).toBeNull();
  });

  it('distributes leases across keys by load', () => {
    pool.add('openai', 'sk-key1');
    pool.add('openai', 'sk-key2');
    pool.add('openai', 'sk-key3');

    const lease1 = pool.acquire()!;
    const lease2 = pool.acquire()!;
    const lease3 = pool.acquire()!;

    const keys = [lease1.apiKey, lease2.apiKey, lease3.apiKey];
    expect(new Set(keys).size).toBe(3);
  });

  it('releases a lease', () => {
    pool.add('openai', 'sk-key1');
    const lease = pool.acquire()!;
    pool.release(lease.leaseId);

    const stats = pool.getStats();
    expect(stats.activeLeases).toBe(0);
  });

  it('marks a key as rate limited', () => {
    pool.add('openai', 'sk-key1');
    pool.add('openai', 'sk-key2');
    pool.markRateLimited('sk-key1', 60000);

    const lease = pool.acquire()!;
    expect(lease.apiKey).toBe('sk-key2');
  });

  it('provides accurate stats', () => {
    pool.add('openai', 'sk-key1');
    pool.add('openai', 'sk-key2');

    pool.acquire()!;
    pool.markRateLimited('sk-key2', 60000);

    const stats = pool.getStats();
    expect(stats.total).toBe(2);
    expect(stats.activeLeases).toBe(1);
    expect(stats.rateLimited).toBe(1);
    expect(stats.available).toBe(1);
  });

  it('ignores release of unknown lease', () => {
    pool.add('openai', 'sk-key1');
    expect(() => pool.release('unknown-lease')).not.toThrow();
  });
});
