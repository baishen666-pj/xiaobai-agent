import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteAdapter } from '../../src/memory/adapters/sqlite-adapter.js';
import type { VectorEntry } from '../../src/memory/vector-store.js';

let betterSqlite3Available = false;
try {
  require.resolve('better-sqlite3');
  betterSqlite3Available = true;
} catch {
  betterSqlite3Available = false;
}

const skip = betterSqlite3Available ? describe : describe.skip;

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `xiaobai-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

skip('SqliteAdapter', () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(async () => {
    dbPath = tmpDbPath();
    adapter = await SqliteAdapter.create({ dbPath });
  });

  afterEach(() => {
    adapter.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    const walPath = dbPath + '-wal';
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath);
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

  it('load returns all entries', async () => {
    await adapter.addBatch([
      { id: 'v1', content: 'alpha', embedding: [0.1, 0.2, 0.3] },
      { id: 'v2', content: 'beta', embedding: [0.4, 0.5, 0.6] },
    ]);

    const entries = await adapter.load();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.id).sort()).toEqual(['v1', 'v2']);
  });

  it('save is a no-op (writes are immediate)', async () => {
    await adapter.add({ id: 'v1', content: 'a', embedding: [1, 0] });
    await adapter.save();
    // Should not throw
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

    const loaded = await adapter.get('v1');
    expect(loaded!.metadata).toEqual({ source: 'kb', page: 5 });
  });

  it('uses custom table name', async () => {
    const customAdapter = await SqliteAdapter.create({ dbPath, tableName: 'custom_vectors' });
    await customAdapter.add({ id: 'v1', content: 'a', embedding: [1, 0] });
    expect(await customAdapter.count()).toBe(1);
    customAdapter.close();
  });

  it('persists across adapter instances', async () => {
    await adapter.add({ id: 'v1', content: 'persist', embedding: [1, 0, 0] });
    adapter.close();

    const adapter2 = await SqliteAdapter.create({ dbPath });
    const entry = await adapter2.get('v1');
    expect(entry).toBeDefined();
    expect(entry!.content).toBe('persist');
    adapter2.close();
  });
});

describe('SqliteAdapter.create error handling', () => {
  it('throws helpful error when better-sqlite3 is not available', async () => {
    // This test always passes: if better-sqlite3 IS installed, we skip it
    // because the import will succeed. If it is NOT installed, we verify the error message.
    if (betterSqlite3Available) {
      // Cannot test error path when package is installed
      return;
    }
    await expect(SqliteAdapter.create({ dbPath: ':memory:' })).rejects.toThrow(
      "SqliteAdapter requires the 'better-sqlite3' package"
    );
  });
});
