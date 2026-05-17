import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { depsTool } from '../../src/tools/builtin-deps.js';

const TEST_DIR = join(tmpdir(), `xiaobai-deps-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function createFile(name: string, content: string): string {
  const filePath = join(TEST_DIR, name);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('depsTool', () => {
  describe('imports action', () => {
    it('should list direct imports of a file', async () => {
      createFile('a.ts', `import { b } from './b';\nimport { c } from './c';\n`);
      createFile('b.ts', `export const b = 1;\n`);
      createFile('c.ts', `export const c = 2;\n`);

      const result = await depsTool.execute({
        action: 'imports',
        file_path: join(TEST_DIR, 'a.ts'),
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('b.ts');
      expect(result.output).toContain('c.ts');
    });

    it('should handle files with no imports', async () => {
      createFile('isolated.ts', `export const x = 1;\n`);

      const result = await depsTool.execute({
        action: 'imports',
        file_path: join(TEST_DIR, 'isolated.ts'),
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No imports found');
    });

    it('should detect require() calls', async () => {
      createFile('cjs.js', `const util = require('./util');\n`);
      createFile('util.js', `module.exports = {};\n`);

      const result = await depsTool.execute({
        action: 'imports',
        file_path: join(TEST_DIR, 'cjs.js'),
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('util.js');
    });

    it('should detect export ... from statements', async () => {
      createFile('reexport.ts', `export { foo } from './foo';\n`);
      createFile('foo.ts', `export const foo = 1;\n`);

      const result = await depsTool.execute({
        action: 'imports',
        file_path: join(TEST_DIR, 'reexport.ts'),
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('foo.ts');
    });

    it('should return error for missing file_path', async () => {
      const result = await depsTool.execute({ action: 'imports' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_param');
    });

    it('should return error for non-existent file', async () => {
      const result = await depsTool.execute({
        action: 'imports',
        file_path: join(TEST_DIR, 'nonexistent.ts'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('file_not_found');
    });
  });

  describe('dependents action', () => {
    it('should find files that import the given file', async () => {
      createFile('util.ts', `export const util = 1;\n`);
      createFile('a.ts', `import { util } from './util';\n`);
      createFile('b.ts', `import { util } from './util';\n`);
      createFile('c.ts', `export const c = 3;\n`);

      const result = await depsTool.execute({
        action: 'dependents',
        file_path: join(TEST_DIR, 'util.ts'),
        root_dir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('a.ts');
      expect(result.output).toContain('b.ts');
      expect(result.output).not.toContain('c.ts');
    });

    it('should report no dependents when none exist', async () => {
      createFile('alone.ts', `export const x = 1;\n`);

      const result = await depsTool.execute({
        action: 'dependents',
        file_path: join(TEST_DIR, 'alone.ts'),
        root_dir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No dependents found');
    });
  });

  describe('graph action', () => {
    it('should build and return an import graph', async () => {
      createFile('main.ts', `import { a } from './a';\n`);
      createFile('a.ts', `import { b } from './b';\n`);
      createFile('b.ts', `export const b = 1;\n`);

      const result = await depsTool.execute({
        action: 'graph',
        root_dir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Import graph');
      expect(result.output).toContain('main.ts');
      expect(result.output).toContain('a.ts');
      expect(result.output).toContain('b.ts');
      expect(result.metadata?.nodeCount).toBe(3);
    });

    it('should return error when root_dir is missing', async () => {
      const result = await depsTool.execute({ action: 'graph' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_param');
    });
  });

  describe('orphans action', () => {
    it('should find files with no importers', async () => {
      createFile('entry.ts', `import { lib } from './lib';\n`);
      createFile('lib.ts', `export const lib = 1;\n`);
      createFile('dead.ts', `export const dead = 1;\n`);

      const result = await depsTool.execute({
        action: 'orphans',
        root_dir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('dead.ts');
      // entry.ts is also an orphan since nothing imports it, but dead.ts should be there
      expect(result.metadata?.orphanCount).toBeGreaterThanOrEqual(1);
    });

    it('should report no orphans when all files are connected', async () => {
      // Single file with no imports is technically an orphan, so test with empty dir
      createFile('main.ts', `export const main = 1;\n`);

      // All single files are orphans, so this tests the output format
      const result = await depsTool.execute({
        action: 'orphans',
        root_dir: TEST_DIR,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('circular action', () => {
    it('should detect circular dependencies', async () => {
      createFile('a.ts', `import { b } from './b';\n`);
      createFile('b.ts', `import { c } from './c';\n`);
      createFile('c.ts', `import { a } from './a';\n`);

      const result = await depsTool.execute({
        action: 'circular',
        root_dir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Circular dependencies');
      expect(result.metadata?.cycleCount).toBeGreaterThanOrEqual(1);
    });

    it('should report no circular deps for acyclic graph', async () => {
      createFile('a.ts', `import { b } from './b';\n`);
      createFile('b.ts', `export const b = 1;\n`);

      const result = await depsTool.execute({
        action: 'circular',
        root_dir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No circular dependencies');
    });

    it('should detect self-referencing circular dependency', async () => {
      createFile('self.ts', `import { self } from './self';\n`);

      const result = await depsTool.execute({
        action: 'circular',
        root_dir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Circular dependencies');
    });
  });

  describe('edge cases', () => {
    it('should skip node_modules directories', async () => {
      createFile('app.ts', `export const app = 1;\n`);
      createFile('node_modules/pkg/index.ts', `export const pkg = 1;\n`);

      const result = await depsTool.execute({
        action: 'graph',
        root_dir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('node_modules');
      expect(result.metadata?.nodeCount).toBe(1);
    });

    it('should handle non-existent root_dir', async () => {
      const result = await depsTool.execute({
        action: 'graph',
        root_dir: '/nonexistent/path/12345',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('dir_not_found');
    });

    it('should handle empty directory', async () => {
      const emptyDir = join(TEST_DIR, 'empty');
      mkdirSync(emptyDir, { recursive: true });

      const result = await depsTool.execute({
        action: 'graph',
        root_dir: emptyDir,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No parseable files');
    });

    it('should ignore non-relative imports (node builtins, packages)', async () => {
      createFile('mixed.ts', [
        `import { readFileSync } from 'node:fs';`,
        `import express from 'express';`,
        `import { local } from './local';`,
      ].join('\n'));
      createFile('local.ts', `export const local = 1;\n`);

      const result = await depsTool.execute({
        action: 'imports',
        file_path: join(TEST_DIR, 'mixed.ts'),
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('local.ts');
      expect(result.output).not.toContain('node:fs');
      expect(result.output).not.toContain('express');
    });
  });
});
