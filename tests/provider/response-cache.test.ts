import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResponseCache } from '../../src/provider/response-cache.js';

describe('ResponseCache', () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache({ maxSize: 5, ttlMs: 1000 });
  });

  it('stores and retrieves responses', () => {
    const messages = [{ role: 'user' as const, content: 'hello' }];
    const response = { content: 'world', model: 'test' };
    cache.set('provider', 'model', messages, response as any);

    const result = cache.get('provider', 'model', messages);
    expect(result).toBeDefined();
    expect(result?.content).toBe('world');
  });

  it('returns null for cache miss', () => {
    const result = cache.get('provider', 'model', [{ role: 'user', content: 'hello' }]);
    expect(result).toBeNull();
  });

  it('different messages produce different keys', () => {
    const msgs1 = [{ role: 'user' as const, content: 'hello' }];
    const msgs2 = [{ role: 'user' as const, content: 'world' }];

    cache.set('provider', 'model', msgs1, { content: 'a' } as any);
    expect(cache.get('provider', 'model', msgs2)).toBeNull();
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    const shortCache = new ResponseCache({ maxSize: 5, ttlMs: 100 });
    const messages = [{ role: 'user' as const, content: 'hello' }];

    shortCache.set('p', 'm', messages, { content: 'cached' } as any);
    expect(shortCache.get('p', 'm', messages)).toBeDefined();

    vi.advanceTimersByTime(150);
    expect(shortCache.get('p', 'm', messages)).toBeNull();
    vi.useRealTimers();
  });

  it('evicts when max size reached', () => {
    for (let i = 0; i < 6; i++) {
      cache.set('p', 'm', [{ role: 'user', content: `msg-${i}` }], { content: i } as any);
    }
    expect(cache.size).toBeLessThanOrEqual(5);
  });

  it('invalidate clears all entries', () => {
    cache.set('p', 'm', [{ role: 'user', content: 'a' }], { content: 'a' } as any);
    cache.set('p', 'm', [{ role: 'user', content: 'b' }], { content: 'b' } as any);
    cache.invalidate();
    expect(cache.size).toBe(0);
  });
});
