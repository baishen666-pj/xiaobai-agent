import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from '../src/core/workspace.js';

describe('Workspace', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'xiaobai-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('sets and gets values', () => {
    const ws = new Workspace(testDir);
    ws.set('key1', 'value1', 'agent_1');
    ws.set('key2', { nested: true }, 'agent_2');

    expect(ws.get('key1')).toBe('value1');
    expect(ws.get<{ nested: boolean }>('key2')).toEqual({ nested: true });
  });

  it('returns undefined for missing keys', () => {
    const ws = new Workspace(testDir);
    expect(ws.get('missing')).toBeUndefined();
  });

  it('checks has correctly', () => {
    const ws = new Workspace(testDir);
    ws.set('exists', true, 'agent_1');

    expect(ws.has('exists')).toBe(true);
    expect(ws.has('nope')).toBe(false);
  });

  it('deletes entries', () => {
    const ws = new Workspace(testDir);
    ws.set('temp', 'data', 'agent_1');
    expect(ws.delete('temp')).toBe(true);
    expect(ws.get('temp')).toBeUndefined();
    expect(ws.delete('temp')).toBe(false);
  });

  it('lists entries', () => {
    const ws = new Workspace(testDir);
    ws.set('a', 1, 'agent_1');
    ws.set('b', 2, 'agent_2');

    const entries = ws.entries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.key).sort()).toEqual(['a', 'b']);
    expect(entries[0].updatedBy).toBe('agent_1');
  });

  it('filters by prefix', () => {
    const ws = new Workspace(testDir);
    ws.set('result:task_1', { ok: true }, 'a1');
    ws.set('result:task_2', { ok: false }, 'a2');
    ws.set('config:mode', 'fast', 'a1');

    const results = ws.getByPrefix('result:');
    expect(results).toHaveLength(2);
  });

  it('writes and reads files', async () => {
    const ws = new Workspace(testDir);
    await ws.init();

    const path = await ws.writeFile('output/code.ts', 'console.log("hi")', 'agent_1');
    expect(path.replace(/\\/g, '/')).toContain('output/code.ts');

    const content = await ws.readFile('output/code.ts');
    expect(content).toBe('console.log("hi")');
  });

  it('returns null for missing files', async () => {
    const ws = new Workspace(testDir);
    const content = await ws.readFile('nonexistent.txt');
    expect(content).toBeNull();
  });

  it('snapshots all in-memory data', () => {
    const ws = new Workspace(testDir);
    ws.set('a', 1, 'x');
    ws.set('b', 2, 'y');

    const snap = ws.snapshot();
    expect(snap).toEqual({ a: 1, b: 2 });
  });

  it('clears all data', () => {
    const ws = new Workspace(testDir);
    ws.set('a', 1, 'x');
    ws.set('b', 2, 'y');
    ws.clear();

    expect(ws.entries()).toHaveLength(0);
    expect(ws.snapshot()).toEqual({});
  });

  it('overwrites existing key', () => {
    const ws = new Workspace(testDir);
    ws.set('key', 'v1', 'a1');
    ws.set('key', 'v2', 'a2');

    expect(ws.get('key')).toBe('v2');
    const entries = ws.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].updatedBy).toBe('a2');
  });
});
