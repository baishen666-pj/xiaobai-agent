import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem } from '../../src/memory/system.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Three-tier Memory System', () => {
  let memDir: string;
  let memory: MemorySystem;

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'xiaobai-mem-'));
    memory = new MemorySystem(memDir);
  });

  afterEach(() => {
    rmSync(memDir, { recursive: true, force: true });
  });

  // ── Session scope ──

  it('session memory is temporary', () => {
    memory.add('session', 'temp note');
    expect(memory.list('session')).toContain('temp note');
  });

  it('session memory is not persisted to disk', () => {
    memory.add('session', 'temp note');
    expect(existsSync(join(memDir, 'memories', 'SESSION.md'))).toBe(false);
  });

  it('session memory can be cleared', () => {
    memory.add('session', 'temp note');
    memory.clearSession();
    expect(memory.list('session')).toEqual([]);
  });

  // ── State scope ──

  it('state memory persists to disk', () => {
    memory.add('state', 'user prefers dark mode');
    expect(existsSync(join(memDir, 'memories', 'STATE.md'))).toBe(true);
  });

  it('state memory survives reload', () => {
    memory.add('state', 'user prefers dark mode');
    const reloaded = new MemorySystem(memDir);
    expect(reloaded.list('state')).toContain('user prefers dark mode');
  });

  // ── Long-term scope ──

  it('long-term memory persists to MEMORY.md', () => {
    memory.add('long-term', 'project uses TypeScript strict mode');
    expect(existsSync(join(memDir, 'memories', 'MEMORY.md'))).toBe(true);
  });

  it('long-term memory survives reload', () => {
    memory.add('long-term', 'project uses TypeScript strict mode');
    const reloaded = new MemorySystem(memDir);
    expect(reloaded.list('long-term')).toContain('project uses TypeScript strict mode');
  });

  // ── Frozen snapshot ──

  it('freeze captures current memory state', async () => {
    memory.add('long-term', 'important fact');
    memory.freeze();
    const snapshot = memory.getFrozenSnapshot();
    expect(snapshot).toContain('important fact');
  });

  it('frozen snapshot does not change after writes', async () => {
    memory.add('long-term', 'fact A');
    memory.freeze();
    memory.add('long-term', 'fact B');
    const snapshot = memory.getFrozenSnapshot();
    expect(snapshot).toContain('fact A');
    expect(snapshot).not.toContain('fact B');
  });

  // ── Legacy compatibility ──

  it('add(target, content) maps to new scopes', () => {
    memory.add('memory', 'long-term note');
    memory.add('user', 'state note');
    expect(memory.list('long-term')).toContain('long-term note');
    expect(memory.list('state')).toContain('state note');
  });

  it('getSystemPromptBlock includes all scopes', async () => {
    memory.add('long-term', 'project rule');
    memory.add('state', 'user preference');
    const block = await memory.getSystemPromptBlock();
    expect(block).toContain('project rule');
    expect(block).toContain('user preference');
  });

  // ── Deduplication ──

  it('does not add duplicate entries', () => {
    memory.add('state', 'same content');
    memory.add('state', 'same content');
    expect(memory.list('state').filter((e) => e === 'same content')).toHaveLength(1);
  });

  // ── Size limits ──

  it('respects character limits', () => {
    const result = memory.add('long-term', 'x'.repeat(3000));
    expect(result.success).toBe(false);
    expect(result.error).toContain('chars');
  });

  it('reports usage', () => {
    memory.add('long-term', 'some text');
    const usage = memory.getUsage();
    expect(usage.memory.used).toBeGreaterThan(0);
    expect(usage.memory.limit).toBeGreaterThan(0);
  });
});
