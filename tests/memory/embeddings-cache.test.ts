import { describe, it, expect, vi } from 'vitest';
import { EmbeddingService, type EmbeddingCacheAdapter } from '../../src/memory/embeddings.js';

function createMockProvider(embedResponse?: number[]) {
  return {
    chat: vi.fn(),
    chatStream: vi.fn(),
    embed: vi.fn().mockResolvedValue({
      embedding: embedResponse ?? [0.1, 0.2, 0.3, 0.4, 0.5],
    }),
    updateConfig: vi.fn(),
  } as any;
}

class MockCacheAdapter implements EmbeddingCacheAdapter {
  private store = new Map<string, number[]>();
  public getCount = 0;
  public setCount = 0;

  async get(key: string): Promise<number[] | undefined> {
    this.getCount++;
    return this.store.get(key);
  }

  async set(key: string, value: number[]): Promise<void> {
    this.setCount++;
    this.store.set(key, value);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }
}

describe('EmbeddingService with cache adapter', () => {
  it('writes through to cache adapter on provider call', async () => {
    const provider = createMockProvider([1.0, 0.0, 0.0]);
    const cacheAdapter = new MockCacheAdapter();
    const service = new EmbeddingService(provider, { cacheAdapter });

    await service.embed('hello world');

    expect(cacheAdapter.setCount).toBe(1);
    expect(await cacheAdapter.size()).toBe(1);
  });

  it('reads from cache adapter on in-memory miss', async () => {
    const provider = createMockProvider([1.0, 0.0, 0.0]);
    const cacheAdapter = new MockCacheAdapter();

    // Pre-populate adapter directly
    await cacheAdapter.set('text-embedding-3-small:hello', [1.0, 0.0, 0.0]);

    const service = new EmbeddingService(provider, { cacheAdapter });

    // Should hit adapter, not provider
    const result = await service.embed('hello');

    expect(provider.embed).not.toHaveBeenCalled();
    expect(result).toEqual([1.0, 0.0, 0.0]);
    // In-memory cache should now have the value too
    expect(service.getCacheSize()).toBe(1);
  });

  it('does not call provider when adapter has the value', async () => {
    const provider = createMockProvider([0.5, 0.5]);
    const cacheAdapter = new MockCacheAdapter();

    // Pre-populate adapter
    await cacheAdapter.set('text-embedding-3-small:cached text', [0.8, 0.2]);

    const service = new EmbeddingService(provider, { cacheAdapter });
    const result = await service.embed('cached text');

    expect(provider.embed).not.toHaveBeenCalled();
    expect(result).toEqual([0.8, 0.2]);
  });

  it('clearCache clears both in-memory and persistent adapter', async () => {
    const provider = createMockProvider([0.1]);
    const cacheAdapter = new MockCacheAdapter();
    const service = new EmbeddingService(provider, { cacheAdapter });

    await service.embed('test');
    expect(service.getCacheSize()).toBe(1);
    expect(await cacheAdapter.size()).toBe(1);

    service.clearCache();
    expect(service.getCacheSize()).toBe(0);
    expect(await cacheAdapter.size()).toBe(0);
  });

  it('works without cache adapter (backward compatible)', async () => {
    const provider = createMockProvider([1.0, 0.0]);
    const service = new EmbeddingService(provider);

    const embedding = await service.embed('test');
    expect(embedding).toEqual([1.0, 0.0]);
    expect(service.getCacheSize()).toBe(1);
  });

  it('works with model string (backward compatible)', async () => {
    const provider = createMockProvider([0.3]);
    const service = new EmbeddingService(provider, 'custom-model');

    await service.embed('test');
    expect(provider.embed).toHaveBeenCalledWith('test', 'custom-model');
  });

  it('works with model string and cache adapter via options', async () => {
    const provider = createMockProvider([0.7, 0.3]);
    const cacheAdapter = new MockCacheAdapter();
    const service = new EmbeddingService(provider, {
      model: 'my-model',
      cacheAdapter,
    });

    await service.embed('test');
    expect(provider.embed).toHaveBeenCalledWith('test', 'my-model');
    expect(await cacheAdapter.size()).toBe(1);
  });

  it('embedBatch writes through to adapter for each text', async () => {
    const provider = createMockProvider([0.1]);
    const cacheAdapter = new MockCacheAdapter();
    const service = new EmbeddingService(provider, { cacheAdapter });

    await service.embedBatch(['a', 'b', 'c']);

    expect(cacheAdapter.setCount).toBe(3);
    expect(await cacheAdapter.size()).toBe(3);
  });
});
