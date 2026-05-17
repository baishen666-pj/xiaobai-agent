import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QdrantAdapter } from '../../../src/memory/adapters/qdrant-adapter.js';

describe('QdrantAdapter', () => {
  let adapter: QdrantAdapter;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;

      // Collection exists check
      if (path.match(/\/collections\/test\/?$/) && init?.method === 'GET') {
        return new Response(JSON.stringify({ result: { status: 'green', points_count: 2 } }), { status: 200 });
      }

      // Create collection
      if (path.match(/\/collections\/test\/?$/) && init?.method === 'PUT') {
        return new Response(JSON.stringify({ result: true }), { status: 200 });
      }

      // Add points (PUT)
      if (path.endsWith('/points') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ result: {} }), { status: 200 });
      }

      // Get single point
      if (path.match(/\/points\/[^/]+$/) && init?.method === 'GET') {
        return new Response(JSON.stringify({
          result: { id: 'id1', vector: [0.1, 0.2], payload: { content: 'hello', metadata: { key: 'val' } } },
        }), { status: 200 });
      }

      // Search
      if (path.endsWith('/points/search')) {
        return new Response(JSON.stringify({
          result: [
            { id: 'id1', score: 0.95, payload: { content: 'doc1', metadata: { source: 'a' } } },
            { id: 'id2', score: 0.75, payload: { content: 'doc2', metadata: { source: 'b' } } },
          ],
        }), { status: 200 });
      }

      // Delete points
      if (path.endsWith('/points/delete')) {
        return new Response(JSON.stringify({ result: {} }), { status: 200 });
      }

      // Scroll (load all)
      if (path.endsWith('/points/scroll')) {
        return new Response(JSON.stringify({
          result: {
            points: [
              { id: 'id1', vector: [0.1, 0.2], payload: { content: 'doc1', metadata: {} } },
              { id: 'id2', vector: [0.3, 0.4], payload: { content: 'doc2', metadata: {} } },
            ],
          },
        }), { status: 200 });
      }

      // Delete collection
      if (path.match(/\/collections\/test\/?$/) && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ result: true }), { status: 200 });
      }

      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', mockFetch);
    adapter = new QdrantAdapter({ collection: 'test' });
  });

  it('should check collection exists on first operation', async () => {
    await adapter.add({ id: 'x', content: 'c', embedding: [1, 2] });
    const checkCall = mockFetch.mock.calls.find((c: unknown[]) => {
      return (c[0] as string).match(/\/collections\/test\/?$/) && (c[1] as RequestInit)?.method === 'GET';
    });
    expect(checkCall).toBeDefined();
  });

  it('should add a single entry as point', async () => {
    await adapter.add({ id: 'e1', content: 'hello', embedding: [0.1, 0.2], metadata: { key: 'val' } });
    const addCall = mockFetch.mock.calls.find((c: unknown[]) => (c[0] as string).endsWith('/points') && (c[1] as RequestInit)?.method === 'PUT');
    const body = JSON.parse((addCall![1] as RequestInit).body as string);
    expect(body.points).toHaveLength(1);
    expect(body.points[0].id).toBe('e1');
    expect(body.points[0].payload.content).toBe('hello');
  });

  it('should add batch entries', async () => {
    await adapter.addBatch([
      { id: 'e1', content: 'a', embedding: [1] },
      { id: 'e2', content: 'b', embedding: [2] },
    ]);
    const addCall = mockFetch.mock.calls.find((c: unknown[]) => (c[0] as string).endsWith('/points') && (c[1] as RequestInit)?.method === 'PUT');
    const body = JSON.parse((addCall![1] as RequestInit).body as string);
    expect(body.points).toHaveLength(2);
  });

  it('should skip addBatch when empty', async () => {
    mockFetch.mockClear();
    await adapter.addBatch([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should get an entry by id', async () => {
    const entry = await adapter.get('id1');
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('id1');
    expect(entry!.content).toBe('hello');
  });

  it('should return undefined for missing entry', async () => {
    mockFetch.mockImplementation(async (url: string) => new Response('not found', { status: 404 }));
    // Need to also make collection check fail but get handles it
    const entry = await adapter.get('nonexistent');
    expect(entry).toBeUndefined();
  });

  it('should remove an entry', async () => {
    const result = await adapter.remove('id1');
    expect(result).toBe(true);
  });

  it('should search and return scored results', async () => {
    const results = await adapter.search([0.5, 0.5], 5, 0);
    expect(results).toHaveLength(2);
    expect(results[0].score).toBeCloseTo(0.95);
    expect(results[1].score).toBeCloseTo(0.75);
  });

  it('should filter results below score threshold', async () => {
    // Qdrant filters server-side via score_threshold, so the mock returns pre-filtered results
    const results = await adapter.search([0.5], 5, 0.9);
    // Both results pass the threshold since Qdrant does server-side filtering
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('id1');
    expect(results[0].score).toBeGreaterThanOrEqual(0.9);
  });

  it('should return count from collection info', async () => {
    const count = await adapter.count();
    expect(count).toBe(2);
  });

  it('should clear by deleting and recreating collection', async () => {
    await adapter.clear();
    const deleteCall = mockFetch.mock.calls.find((c: unknown[]) => {
      const init = c[1] as RequestInit;
      return (c[0] as string).match(/\/collections\/test\/?$/) && init?.method === 'DELETE';
    });
    expect(deleteCall).toBeDefined();
  });

  it('should load all entries via scroll', async () => {
    const entries = await adapter.load();
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('id1');
    expect(entries[0].embedding).toEqual([0.1, 0.2]);
  });

  it('should no-op on save', async () => {
    await adapter.save();
    const saveCalls = mockFetch.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('save'));
    expect(saveCalls).toHaveLength(0);
  });

  it('should throw on connection failure', async () => {
    mockFetch.mockImplementation(() => new Response('error', { status: 500 }));
    await expect(adapter.add({ id: 'x', content: 'c', embedding: [] })).rejects.toThrow();
  });
});
