import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JsonFileAdapter } from '../../src/memory/adapters/json-file-adapter.js';
import type { VectorEntry } from '../../src/memory/vector-store.js';

function tmpFilePath(): string {
  return path.join(os.tmpdir(), `xiaobai-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe('JsonFileAdapter', () => {
  let filePath: string;
  let adapter: JsonFileAdapter;

  beforeEach(() => {
    filePath = tmpFilePath();
    adapter = new JsonFileAdapter({ filePath });
  });

  afterEach(() => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  it('adds and retrieves entries', async () => {
    const entry: VectorEntry = { id: 'v1', content: 'hello', embedding: [1, 0, 0] };
    await adapter.add(entry);

    const result = await adapter.get('v1');
    expect(result).toEqual(entry);
  });

  it('addBatch adds multiple entries', async () => {
    const entries: VectorEntry[] = [
      { id: 'v1', content: 'a', embedding: [1, 0, 0] },
      { id: 'v2', content: 'b', embedding: [0, 1, 0] },
    ];
    await adapter.addBatch(entries);

    expect(await adapter.count()).toBe(2);
    expect(await adapter.get('v1')).toBeDefined();
    expect(await adapter.get('v2')).toBeDefined();
  });

  it('removes entries', async () => {
    await adapter.add({ id: 'v1', content: 'a', embedding: [1, 0, 0] });
    expect(await adapter.remove('v1')).toBe(true);
    expect(await adapter.remove('v1')).toBe(false);
    expect(await adapter.count()).toBe(0);
  });

  it('returns undefined for missing entries', async () => {
    const result = await adapter.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('searches by cosine similarity', async () => {
    await adapter.addBatch([
      { id: 'v1', content: 'cat', embedding: [1, 0, 0] },
      { id: 'v2', content: 'dog', embedding: [0, 1, 0] },
      { id: 'v3', content: 'apple', embedding: [0.7, 0.7, 0] },
    ]);

    const results = await adapter.search([1, 0, 0], 2, 0);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('v1');
    expect(results[0].score).toBeCloseTo(1);
  });

  it('respects minScore filter in search', async () => {
    await adapter.addBatch([
      { id: 'v1', content: 'exact', embedding: [1, 0, 0] },
      { id: 'v2', content: 'orthogonal', embedding: [0, 1, 0] },
    ]);

    const results = await adapter.search([1, 0, 0], 10, 0.5);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('v1');
  });

  it('clears all entries', async () => {
    await adapter.add({ id: 'v1', content: 'a', embedding: [1, 0, 0] });
    await adapter.clear();
    expect(await adapter.count()).toBe(0);
  });

  it('saves to JSON file', async () => {
    await adapter.add({ id: 'v1', content: 'hello', embedding: [1, 0, 0] });
    await adapter.save();

    expect(fs.existsSync(filePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].id).toBe('v1');
    expect(typeof data.savedAt).toBe('number');
  });

  it('loads from JSON file', async () => {
    await adapter.add({ id: 'v1', content: 'hello', embedding: [1, 0, 0] });
    await adapter.add({ id: 'v2', content: 'world', embedding: [0, 1, 0] });
    await adapter.save();

    // Create new adapter pointing to same file
    const adapter2 = new JsonFileAdapter({ filePath });
    const entries = await adapter2.load();

    expect(entries).toHaveLength(2);
    expect(await adapter2.count()).toBe(2);
    expect(await adapter2.get('v1')).toBeDefined();
  });

  it('returns empty array when loading from nonexistent file', async () => {
    const entries = await adapter.load();
    expect(entries).toEqual([]);
  });

  it('overwrites entries with same id', async () => {
    await adapter.add({ id: 'v1', content: 'original', embedding: [1, 0, 0] });
    await adapter.add({ id: 'v1', content: 'updated', embedding: [0, 1, 0] });

    const entry = await adapter.get('v1');
    expect(entry!.content).toBe('updated');
    expect(await adapter.count()).toBe(1);
  });

  it('preserves metadata', async () => {
    const entry: VectorEntry = {
      id: 'v1',
      content: 'test',
      embedding: [1, 0, 0],
      metadata: { source: 'kb', page: 5 },
    };
    await adapter.add(entry);
    await adapter.save();

    const adapter2 = new JsonFileAdapter({ filePath });
    await adapter2.load();
    const loaded = await adapter2.get('v1');
    expect(loaded!.metadata).toEqual({ source: 'kb', page: 5 });
  });

  it('creates parent directories on save', async () => {
    const nestedPath = path.join(os.tmpdir(), `xiaobai-test-${Date.now()}`, 'nested', 'store.json');
    const nestedAdapter = new JsonFileAdapter({ filePath: nestedPath });

    await nestedAdapter.add({ id: 'v1', content: 'a', embedding: [1, 0] });
    await nestedAdapter.save();

    expect(fs.existsSync(nestedPath)).toBe(true);

    // Cleanup
    fs.rmSync(path.dirname(nestedPath), { recursive: true, force: true });
  });

  it('save-load roundtrip preserves all data', async () => {
    const entries: VectorEntry[] = [
      { id: 'v1', content: 'alpha', embedding: [0.1, 0.2, 0.3] },
      { id: 'v2', content: 'beta', embedding: [0.4, 0.5, 0.6], metadata: { tag: 'test' } },
    ];

    await adapter.addBatch(entries);
    await adapter.save();

    const adapter2 = new JsonFileAdapter({ filePath });
    await adapter2.load();

    for (const entry of entries) {
      const loaded = await adapter2.get(entry.id);
      expect(loaded).toEqual(entry);
    }
  });
});
