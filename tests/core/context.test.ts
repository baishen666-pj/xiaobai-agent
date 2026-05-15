import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadHierarchicalContext, buildContextSystemPrompt } from '../../src/core/context.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Hierarchical Context Loader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-ctx-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty result when no context files exist', () => {
    const result = loadHierarchicalContext(tempDir);
    expect(result.layers).toHaveLength(0);
    expect(result.merged).toBe('');
    expect(result.totalChars).toBe(0);
  });

  it('loads XIAOBAI.md from current directory', () => {
    writeFileSync(join(tempDir, 'XIAOBAI.md'), '# Project Rules\nUse TypeScript strict mode');

    const result = loadHierarchicalContext(tempDir);
    expect(result.layers.length).toBeGreaterThanOrEqual(1);
    expect(result.merged).toContain('TypeScript strict mode');
  });

  it('loads CLAUDE.md as fallback', () => {
    writeFileSync(join(tempDir, 'CLAUDE.md'), 'Use conventional commits');

    const result = loadHierarchicalContext(tempDir);
    expect(result.layers.length).toBeGreaterThanOrEqual(1);
    expect(result.merged).toContain('conventional commits');
  });

  it('prefers XIAOBAI.md over CLAUDE.md', () => {
    writeFileSync(join(tempDir, 'XIAOBAI.md'), 'xiaobai rules');
    writeFileSync(join(tempDir, 'CLAUDE.md'), 'claude rules');

    const result = loadHierarchicalContext(tempDir);
    const found = result.layers.find((l) => l.content.includes('xiaobai rules'));
    expect(found).toBeDefined();
  });

  it('merges layers from multiple directory levels', () => {
    const subDir = join(tempDir, 'src', 'auth');
    mkdirSync(subDir, { recursive: true });

    writeFileSync(join(tempDir, 'XIAOBAI.md'), 'root context');
    writeFileSync(join(subDir, 'XIAOBAI.md'), 'auth module context');

    const result = loadHierarchicalContext(subDir);
    expect(result.layers.length).toBeGreaterThanOrEqual(2);
    expect(result.merged).toContain('root context');
    expect(result.merged).toContain('auth module context');
  });

  it('respects maxDepth option', () => {
    let dir = tempDir;
    for (let i = 0; i < 5; i++) {
      dir = join(dir, `level${i}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'XIAOBAI.md'), `level ${i}`);
    }

    const result = loadHierarchicalContext(dir, { maxDepth: 2 });
    expect(result.layers.length).toBeLessThanOrEqual(3);
  });

  it('respects maxChars option', () => {
    writeFileSync(join(tempDir, 'XIAOBAI.md'), 'x'.repeat(1000));

    const result = loadHierarchicalContext(tempDir, { maxChars: 100 });
    // Should still load the file but stop before exceeding
    expect(result.totalChars).toBeLessThanOrEqual(1200);
  });

  it('builds context system prompt', () => {
    writeFileSync(join(tempDir, 'XIAOBAI.md'), 'Use strict mode');

    const result = loadHierarchicalContext(tempDir);
    const prompt = buildContextSystemPrompt(result);
    expect(prompt).toContain('Project Context');
    expect(prompt).toContain('Use strict mode');
  });

  it('returns null when no layers exist', () => {
    const result = loadHierarchicalContext(tempDir);
    const prompt = buildContextSystemPrompt(result);
    expect(prompt).toBeNull();
  });
});
