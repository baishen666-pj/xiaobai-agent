import { describe, it, expect, vi } from 'vitest';
import { RAGEngine } from '../../src/memory/rag.js';
import type { VectorStoreAdapter, SearchResult, VectorEntry } from '../../src/memory/vector-store.js';
import { cosineSimilarity } from '../../src/memory/vector-store.js';

function createMockProvider() {
  return {
    chat: vi.fn(),
    embed: vi.fn(async (text: string) => {
      const vec = new Array(8).fill(0).map((_, i) => (text.length * 0.1 + i * 0.01));
      return { embedding: vec };
    }),
  } as any;
}

function createMockAdapter(searchResults: SearchResult[]): VectorStoreAdapter {
  return {
    add: vi.fn(async () => {}),
    addBatch: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    remove: vi.fn(async () => true),
    search: vi.fn(async () => searchResults),
    count: vi.fn(async () => searchResults.length),
    clear: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    load: vi.fn(async () => []),
  };
}

describe('RAGEngine retrieve with persistence adapter', () => {
  it('should load persisted entries and search in-memory', async () => {
    const provider = createMockProvider();
    const embedResult = await provider.embed('adapter result');
    const entries: VectorEntry[] = [
      { id: 'c1', content: 'adapter result', embedding: embedResult.embedding, metadata: { source: 'remote' } },
    ];
    const adapter = {
      add: vi.fn(async () => {}),
      addBatch: vi.fn(async () => {}),
      get: vi.fn(async () => undefined),
      remove: vi.fn(async () => true),
      search: vi.fn(async () => []),
      count: vi.fn(async () => entries.length),
      clear: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      load: vi.fn(async () => entries),
    };

    const engine = new RAGEngine(provider, { topK: 5, minScore: 0 }, adapter);
    await engine.loadPersisted();

    const result = await engine.retrieve('adapter result');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].content).toBe('adapter result');
  });

  it('should fall back to in-memory search when no adapter', async () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider, { topK: 5, minScore: 0 });

    // Index a document first
    await engine.indexDocument({ id: 'doc1', content: 'hello world' });

    const result = await engine.retrieve('hello world');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].content).toBe('hello world');
  });

  it('should still index to both in-memory and adapter', async () => {
    const adapter = createMockAdapter([]);
    const provider = createMockProvider();
    const engine = new RAGEngine(provider, undefined, adapter);

    await engine.indexDocument({ id: 'doc1', content: 'test content for indexing' });

    // adapter.add should have been called for each chunk
    expect(adapter.add).toHaveBeenCalled();
  });

  it('should return assembled context with scores', async () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider, { topK: 5, minScore: 0 });

    await engine.indexDocument({ id: 'doc1', content: 'result text', source: 'doc1' });
    const result = await engine.retrieve('result text');

    expect(result.assembledContext).toContain('result text');
    expect(result.query).toBe('result text');
  });
});
