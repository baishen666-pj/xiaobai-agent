import { describe, it, expect, vi } from 'vitest';
import { EmbeddingService } from '../../src/memory/embeddings.js';

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

describe('EmbeddingService', () => {
  it('returns embedding from provider', async () => {
    const provider = createMockProvider([1.0, 0.0, 0.0]);
    const service = new EmbeddingService(provider);

    const embedding = await service.embed('hello world');

    expect(embedding).toEqual([1.0, 0.0, 0.0]);
    expect(provider.embed).toHaveBeenCalledOnce();
  });

  it('caches identical requests', async () => {
    const provider = createMockProvider([0.5, 0.5]);
    const service = new EmbeddingService(provider);

    await service.embed('test');
    await service.embed('test');

    expect(provider.embed).toHaveBeenCalledOnce();
    expect(service.getCacheSize()).toBe(1);
  });

  it('falls back to keyword-based embedding on provider failure', async () => {
    const provider = {
      chat: vi.fn(),
      chatStream: vi.fn(),
      embed: vi.fn().mockRejectedValue(new Error('Provider down')),
      updateConfig: vi.fn(),
    } as any;
    const service = new EmbeddingService(provider);

    const embedding = await service.embed('test input', { dimensions: 8 });

    expect(embedding).toHaveLength(8);
    const norm = Math.sqrt(embedding.reduce((s: number, v: number) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 4);
  });

  it('embedBatch returns array of embeddings', async () => {
    const provider = createMockProvider([0.1, 0.2]);
    const service = new EmbeddingService(provider);

    const results = await service.embedBatch(['a', 'b', 'c']);

    expect(results).toHaveLength(3);
    for (const emb of results) {
      expect(emb).toEqual([0.1, 0.2]);
    }
  });

  it('clears cache', async () => {
    const provider = createMockProvider([0.5]);
    const service = new EmbeddingService(provider);

    await service.embed('test');
    expect(service.getCacheSize()).toBe(1);

    service.clearCache();
    expect(service.getCacheSize()).toBe(0);
  });

  it('handles non-JSON provider response gracefully', async () => {
    const provider = {
      chat: vi.fn(),
      chatStream: vi.fn(),
      embed: vi.fn().mockRejectedValue(new Error('No embedding API')),
      updateConfig: vi.fn(),
    } as any;
    const service = new EmbeddingService(provider);

    const embedding = await service.embed('fallback test', { dimensions: 4 });

    expect(embedding).toHaveLength(4);
  });

  it('uses default model when calling provider.embed', async () => {
    const provider = createMockProvider([0.0]);
    const service = new EmbeddingService(provider, 'custom-model');

    await service.embed('test');

    expect(provider.embed).toHaveBeenCalledWith('test', 'custom-model');
  });

  it('produces deterministic fallback embeddings for same input', async () => {
    const provider = {
      chat: vi.fn(),
      chatStream: vi.fn(),
      embed: vi.fn().mockRejectedValue(new Error('fail')),
      updateConfig: vi.fn(),
    } as any;
    const service = new EmbeddingService(provider);

    const emb1 = await service.embed('deterministic', { dimensions: 8 });
    const emb2 = await service.embed('deterministic', { dimensions: 8 });

    expect(emb1).toEqual(emb2);
  });
});
