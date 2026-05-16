import { describe, it, expect, vi } from 'vitest';
import { RAGEngine, type RAGDocument } from '../../src/memory/rag.js';

function createMockProvider() {
  let callCount = 0;
  return {
    chat: vi.fn().mockImplementation(async (messages: any) => {
      callCount++;
      const text = messages[0]?.content ?? '';
      // Generate deterministic pseudo-embedding based on text content
      const emb = new Array(8).fill(0);
      for (let i = 0; i < text.length; i++) {
        emb[i % 8] += Math.sin(text.charCodeAt(i) * 0.1);
      }
      const norm = Math.sqrt(emb.reduce((s: number, v: number) => s + v * v, 0)) || 1;
      return { content: `[${emb.map((v: number) => v / norm).join(',')}]` };
    }),
    chatStream: vi.fn(),
    updateConfig: vi.fn(),
  };
}

describe('RAGEngine', () => {
  it('indexes a document and retrieves it', async () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider as any, { topK: 3, minScore: 0, chunkSize: 1000 });

    await engine.indexDocument({
      id: 'doc1',
      content: 'TypeScript is a strongly typed programming language that builds on JavaScript.',
      source: 'guide.md',
    });

    expect(engine.getDocumentCount()).toBe(1);
    expect(engine.getChunkCount()).toBe(1);

    const result = await engine.retrieve('What is TypeScript?');
    expect(result.query).toBe('What is TypeScript?');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.assembledContext).toContain('TypeScript');
  });

  it('chunks large documents', async () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider as any, { chunkSize: 50, chunkOverlap: 10 });

    const longText = 'A '.repeat(200);
    await engine.indexDocument({ id: 'long', content: longText });

    expect(engine.getChunkCount()).toBeGreaterThan(1);
  });

  it('removes a document', async () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider as any);

    await engine.indexDocument({ id: 'doc1', content: 'hello world' });
    expect(engine.getDocumentCount()).toBe(1);

    const removed = engine.removeDocument('doc1');
    expect(removed).toBe(true);
    expect(engine.getDocumentCount()).toBe(0);
    expect(engine.getChunkCount()).toBe(0);
  });

  it('removing non-existent document returns false', () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider as any);
    expect(engine.removeDocument('nope')).toBe(false);
  });

  it('indexes batch of documents', async () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider as any);

    const count = await engine.indexBatch([
      { id: 'd1', content: 'Document one' },
      { id: 'd2', content: 'Document two' },
      { id: 'd3', content: 'Document three' },
    ]);

    expect(count).toBe(3);
    expect(engine.getDocumentCount()).toBe(3);
  });

  it('retrieves with assembled context', async () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider as any, { topK: 3, minScore: 0 });

    await engine.indexDocument({
      id: 'api',
      content: 'The API endpoint is /api/v1/users',
      source: 'api-docs.md',
    });

    const result = await engine.retrieve('users endpoint');
    expect(result.assembledContext).toContain('source:');
    expect(result.assembledContext).toContain('score:');
  });

  it('clears all data', async () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider as any);

    await engine.indexDocument({ id: 'd1', content: 'test' });
    engine.clear();

    expect(engine.getDocumentCount()).toBe(0);
    expect(engine.getChunkCount()).toBe(0);
  });

  it('getDocument returns document by id', async () => {
    const provider = createMockProvider();
    const engine = new RAGEngine(provider as any);

    await engine.indexDocument({ id: 'doc1', content: 'test content', source: 'test.md' });

    const doc = engine.getDocument('doc1');
    expect(doc).toBeDefined();
    expect(doc!.content).toBe('test content');
    expect(doc!.source).toBe('test.md');
  });
});
