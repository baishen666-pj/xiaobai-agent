import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RAGEngine, type RAGDocument } from '../../src/memory/rag.js';
import type { VectorStoreAdapter, VectorEntry } from '../../src/memory/vector-store.js';

function createMockProvider() {
  return {
    chat: vi.fn(),
    chatStream: vi.fn(),
    embed: vi.fn().mockImplementation(async (text: string) => {
      const emb = new Array(8).fill(0);
      for (let i = 0; i < text.length; i++) {
        emb[i % 8] += Math.sin(text.charCodeAt(i) * 0.1);
      }
      const norm = Math.sqrt(emb.reduce((s: number, v: number) => s + v * v, 0)) || 1;
      return { embedding: emb.map((v: number) => v / norm) };
    }),
    updateConfig: vi.fn(),
  };
}

class MockPersistenceAdapter implements VectorStoreAdapter {
  private entries = new Map<string, VectorEntry>();
  public saveCalled = 0;
  public clearCalled = 0;

  async add(entry: VectorEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async addBatch(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
    }
  }

  async get(id: string): Promise<VectorEntry | undefined> {
    return this.entries.get(id);
  }

  async remove(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async search(): Promise<import('../../src/memory/vector-store.js').SearchResult[]> {
    return [];
  }

  async count(): Promise<number> {
    return this.entries.size;
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.clearCalled++;
  }

  async save(): Promise<void> {
    this.saveCalled++;
  }

  async load(): Promise<VectorEntry[]> {
    return Array.from(this.entries.values());
  }
}

describe('RAGEngine with persistence', () => {
  let provider: ReturnType<typeof createMockProvider>;
  let adapter: MockPersistenceAdapter;

  beforeEach(() => {
    provider = createMockProvider();
    adapter = new MockPersistenceAdapter();
  });

  it('calls persistence.add for each chunk and persistence.save after indexing', async () => {
    const engine = new RAGEngine(provider as any, { chunkSize: 1000 }, adapter);

    await engine.indexDocument({ id: 'doc1', content: 'Hello world from document one' });

    expect(adapter.saveCalled).toBe(1);
    expect(await adapter.count()).toBe(1);
  });

  it('calls persistence.remove when removing a document', async () => {
    const engine = new RAGEngine(provider as any, { chunkSize: 1000 }, adapter);

    await engine.indexDocument({ id: 'doc1', content: 'Hello world' });
    expect(await adapter.count()).toBe(1);

    engine.removeDocument('doc1');
    expect(await adapter.count()).toBe(0);
  });

  it('calls persistence.clear when clearing the engine', async () => {
    const engine = new RAGEngine(provider as any, { chunkSize: 1000 }, adapter);

    await engine.indexDocument({ id: 'doc1', content: 'Hello world' });
    engine.clear();

    expect(adapter.clearCalled).toBe(1);
  });

  it('loadPersisted returns 0 when no persistence adapter', async () => {
    const engine = new RAGEngine(provider as any);
    const count = await engine.loadPersisted();
    expect(count).toBe(0);
  });

  it('loadPersisted loads entries from adapter into vector store', async () => {
    // Use the same embedding the mock provider would generate for "preloaded content"
    const queryText = 'preloaded content';
    const emb = new Array(8).fill(0);
    for (let i = 0; i < queryText.length; i++) {
      emb[i % 8] += Math.sin(queryText.charCodeAt(i) * 0.1);
    }
    const norm = Math.sqrt(emb.reduce((s: number, v: number) => s + v * v, 0)) || 1;
    const normalizedEmb = emb.map((v: number) => v / norm);

    // Pre-populate adapter with entries using the same embedding
    await adapter.add({
      id: 'chunk_1',
      content: 'preloaded content',
      embedding: normalizedEmb,
      metadata: { documentId: 'doc1' },
    });
    await adapter.add({
      id: 'chunk_2',
      content: 'more content',
      embedding: normalizedEmb,
      metadata: { documentId: 'doc1' },
    });

    const engine = new RAGEngine(provider as any, { topK: 5, minScore: 0 }, adapter);
    const loaded = await engine.loadPersisted();

    expect(loaded).toBe(2);

    // Verify the preloaded vectors are searchable
    const result = await engine.retrieve(queryText);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('works without persistence adapter (backward compatible)', async () => {
    const engine = new RAGEngine(provider as any, { topK: 3, minScore: 0, chunkSize: 1000 });

    await engine.indexDocument({
      id: 'doc1',
      content: 'TypeScript is a strongly typed programming language.',
      source: 'guide.md',
    });

    expect(engine.getDocumentCount()).toBe(1);
    const result = await engine.retrieve('What is TypeScript?');
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('indexes multiple chunks and persists each', async () => {
    const engine = new RAGEngine(provider as any, { chunkSize: 20, chunkOverlap: 5 }, adapter);

    const longText = 'A '.repeat(200);
    await engine.indexDocument({ id: 'long', content: longText });

    const chunkCount = engine.getChunkCount();
    expect(chunkCount).toBeGreaterThan(1);
    expect(await adapter.count()).toBe(chunkCount);
    expect(adapter.saveCalled).toBe(1);
  });

  it('indexes batch with persistence', async () => {
    const engine = new RAGEngine(provider as any, { chunkSize: 1000 }, adapter);

    const count = await engine.indexBatch([
      { id: 'd1', content: 'Document one' },
      { id: 'd2', content: 'Document two' },
      { id: 'd3', content: 'Document three' },
    ]);

    expect(count).toBe(3);
    expect(adapter.saveCalled).toBe(3); // save called once per document
    expect(await adapter.count()).toBe(3);
  });
});
