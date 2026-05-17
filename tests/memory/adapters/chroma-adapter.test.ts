import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChromaDBAdapter } from '../../../src/memory/adapters/chroma-adapter.js';

describe('ChromaDBAdapter', () => {
  let adapter: ChromaDBAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  const mockCollectionResponse = { id: 'col-123', name: 'test' };

  beforeEach(() => {
    mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;

      if (path === '/api/v1/collections' && init?.method === 'POST') {
        return new Response(JSON.stringify(mockCollectionResponse), { status: 200 });
      }

      if (path.includes('/add')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }

      if (path.includes('/query')) {
        return new Response(JSON.stringify({
          ids: [['id1', 'id2']],
          documents: [['doc1', 'doc2']],
          distances: [[0.1, 0.3]],
          metadatas: [[{ source: 'a' }, { source: 'b' }]],
        }), { status: 200 });
      }

      if (path.endsWith('/count')) {
        return new Response(JSON.stringify(42), { status: 200 });
      }

      if (path.includes('/get') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        if (body.ids) {
          return new Response(JSON.stringify({
            ids: body.ids,
            embeddings: [[[0.1, 0.2]]],
            documents: ['content'],
            metadatas: [{ key: 'val' }],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          ids: ['id1', 'id2'],
          embeddings: [[0.1, 0.2], [0.3, 0.4]],
          documents: ['doc1', 'doc2'],
          metadatas: [{}, {}],
        }), { status: 200 });
      }

      if (path.includes('/delete') && init?.method === 'POST') {
        return new Response(JSON.stringify({}), { status: 200 });
      }

      if (path.includes('/delete') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({}), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', mockFetch);
    adapter = new ChromaDBAdapter({ collection: 'test' });
  });

  it('should create collection on first operation', async () => {
    await adapter.add({ id: 'x', content: 'c', embedding: [1, 2] });
    const createCall = mockFetch.mock.calls.find((c: unknown[]) => {
      const u = (c[0] as string);
      return u.includes('/api/v1/collections') && (c[1] as RequestInit)?.method === 'POST';
    });
    expect(createCall).toBeDefined();
  });

  it('should add a single entry', async () => {
    await adapter.add({ id: 'e1', content: 'hello', embedding: [0.1, 0.2], metadata: { key: 'val' } });
    const addCall = mockFetch.mock.calls.find((c: unknown[]) => (c[0] as string).includes('/add'));
    const body = JSON.parse((addCall![1] as RequestInit).body as string);
    expect(body.ids).toEqual(['e1']);
    expect(body.documents).toEqual(['hello']);
  });

  it('should add batch entries', async () => {
    await adapter.addBatch([
      { id: 'e1', content: 'a', embedding: [1] },
      { id: 'e2', content: 'b', embedding: [2] },
    ]);
    const addCall = mockFetch.mock.calls.find((c: unknown[]) => (c[0] as string).includes('/add'));
    const body = JSON.parse((addCall![1] as RequestInit).body as string);
    expect(body.ids).toEqual(['e1', 'e2']);
    expect(body.documents).toEqual(['a', 'b']);
  });

  it('should skip addBatch when empty', async () => {
    mockFetch.mockClear();
    await adapter.addBatch([]);
    // Only the ensureCollection call should happen (or none since early return)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should get an entry by id', async () => {
    const entry = await adapter.get('id1');
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('id1');
  });

  it('should return undefined for missing entry', async () => {
    mockFetch.mockImplementationOnce(() => new Response(JSON.stringify({ ids: [], embeddings: [], documents: [], metadatas: [] }), { status: 200 }));
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/api/v1/collections' && init?.method === 'POST') {
        return new Response(JSON.stringify(mockCollectionResponse), { status: 200 });
      }
      return new Response(JSON.stringify({ ids: [], embeddings: [], documents: [], metadatas: [] }), { status: 200 });
    });
    const entry = await adapter.get('nonexistent');
    expect(entry).toBeUndefined();
  });

  it('should remove an entry', async () => {
    const result = await adapter.remove('id1');
    expect(result).toBe(true);
  });

  it('should search and convert distances to scores', async () => {
    const results = await adapter.search([0.5, 0.5], 5, 0);
    expect(results).toHaveLength(2);
    expect(results[0].score).toBeCloseTo(0.9); // 1 - 0.1
    expect(results[1].score).toBeCloseTo(0.7); // 1 - 0.3
  });

  it('should filter results below minScore', async () => {
    const results = await adapter.search([0.5], 5, 0.85);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('id1');
  });

  it('should return count', async () => {
    const count = await adapter.count();
    expect(count).toBe(42);
  });

  it('should clear by deleting and recreating collection', async () => {
    // First ensure collection is initialized so collectionId is set
    await adapter.count();
    // Reset mock to track clear() calls specifically
    mockFetch.mockClear();
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path.includes('/delete') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (path === '/api/v1/collections' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'col-new', name: 'test' }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    await adapter.clear();

    const deleteCall = mockFetch.mock.calls.find((c: unknown[]) => {
      return (c[1] as RequestInit)?.method === 'DELETE';
    });
    expect(deleteCall).toBeDefined();
  });

  it('should load all entries', async () => {
    const entries = await adapter.load();
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('id1');
  });

  it('should no-op on save', async () => {
    await adapter.save();
    // save should not make any HTTP calls beyond collection init
    const saveCalls = mockFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('save'));
    expect(saveCalls).toHaveLength(0);
  });

  it('should throw on connection failure', async () => {
    mockFetch.mockImplementation(() => new Response('error', { status: 500 }));
    await expect(adapter.add({ id: 'x', content: 'c', embedding: [] })).rejects.toThrow();
  });
});
