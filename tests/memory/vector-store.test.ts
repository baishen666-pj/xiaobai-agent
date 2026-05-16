import { describe, it, expect } from 'vitest';
import { VectorStore, type VectorEntry } from '../../src/memory/vector-store.js';

describe('VectorStore', () => {
  it('adds and retrieves entries', () => {
    const store = new VectorStore(3);
    const entry: VectorEntry = {
      id: 'v1',
      content: 'hello world',
      embedding: [1, 0, 0],
    };

    store.add(entry);
    expect(store.get('v1')).toEqual(entry);
    expect(store.size()).toBe(1);
  });

  it('addBatch adds multiple entries', () => {
    const store = new VectorStore(3);
    store.addBatch([
      { id: 'v1', content: 'a', embedding: [1, 0, 0] },
      { id: 'v2', content: 'b', embedding: [0, 1, 0] },
      { id: 'v3', content: 'c', embedding: [0, 0, 1] },
    ]);

    expect(store.size()).toBe(3);
  });

  it('removes entries', () => {
    const store = new VectorStore(3);
    store.add({ id: 'v1', content: 'a', embedding: [1, 0, 0] });
    expect(store.remove('v1')).toBe(true);
    expect(store.remove('v1')).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('searches by cosine similarity', () => {
    const store = new VectorStore(3);
    store.addBatch([
      { id: 'v1', content: 'cat', embedding: [1, 0, 0] },
      { id: 'v2', content: 'dog', embedding: [0, 1, 0] },
      { id: 'v3', content: 'apple', embedding: [0.7, 0.7, 0] },
    ]);

    const results = store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('v1');
    expect(results[0].score).toBeCloseTo(1);
    expect(results[1].id).toBe('v3');
    expect(results[1].score).toBeGreaterThan(0);
  });

  it('respects minScore filter', () => {
    const store = new VectorStore(3);
    store.addBatch([
      { id: 'v1', content: 'exact', embedding: [1, 0, 0] },
      { id: 'v2', content: 'orthogonal', embedding: [0, 1, 0] },
    ]);

    const results = store.search([1, 0, 0], 10, 0.5);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('v1');
  });

  it('returns empty for empty store', () => {
    const store = new VectorStore(3);
    const results = store.search([1, 0, 0]);
    expect(results).toHaveLength(0);
  });

  it('handles zero vector query', () => {
    const store = new VectorStore(3);
    store.add({ id: 'v1', content: 'a', embedding: [1, 0, 0] });

    const results = store.search([0, 0, 0], 5, 0.01);
    expect(results).toHaveLength(0);
  });

  it('clears all entries', () => {
    const store = new VectorStore(3);
    store.add({ id: 'v1', content: 'a', embedding: [1, 0, 0] });
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('getAll returns all entries', () => {
    const store = new VectorStore(3);
    store.addBatch([
      { id: 'v1', content: 'a', embedding: [1, 0, 0] },
      { id: 'v2', content: 'b', embedding: [0, 1, 0] },
    ]);

    const all = store.getAll();
    expect(all).toHaveLength(2);
  });

  it('returns correct dimension', () => {
    const store = new VectorStore(512);
    expect(store.getDimension()).toBe(512);
  });

  it('handles mismatched dimensions gracefully', () => {
    const store = new VectorStore(3);
    store.add({ id: 'v1', content: 'a', embedding: [1, 0, 0] });

    const results = store.search([1, 0, 0, 0]);
    expect(results[0].score).toBe(0);
  });

  it('preserves metadata in search results', () => {
    const store = new VectorStore(3);
    store.add({
      id: 'v1',
      content: 'test',
      embedding: [1, 0, 0],
      metadata: { source: 'knowledge-base', page: 5 },
    });

    const results = store.search([1, 0, 0]);
    expect(results[0].metadata).toEqual({ source: 'knowledge-base', page: 5 });
  });

  it('sorts results by score descending', () => {
    const store = new VectorStore(3);
    store.addBatch([
      { id: 'v1', content: 'low', embedding: [0.3, 0.95, 0] },
      { id: 'v2', content: 'high', embedding: [0.99, 0.1, 0] },
      { id: 'v3', content: 'mid', embedding: [0.7, 0.7, 0] },
    ]);

    const results = store.search([1, 0, 0], 3);
    expect(results[0].id).toBe('v2');
    expect(results[1].id).toBe('v3');
    expect(results[2].id).toBe('v1');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
