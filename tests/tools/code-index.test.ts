import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodeIndexer, type SymbolDef } from '../../src/tools/code-index.js';

const TEST_DIR = join(tmpdir(), `xiaobai-index-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function createTestFile(name: string, content: string): string {
  const filePath = join(TEST_DIR, name);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('CodeIndexer', () => {
  describe('buildIndex', () => {
    it('should index a TypeScript file', async () => {
      createTestFile('sample.ts', `
export function hello(): string {
  return "hello";
}

class MyClass {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  public greet(): string {
    return this.name;
  }
}

interface MyInterface {
  id: number;
  label: string;
}

type MyType = { value: number };

enum Status { Active, Inactive }

const VERSION = "1.0";
`);

      const indexer = new CodeIndexer(TEST_DIR);
      const result = await indexer.buildIndex();

      expect(result.files).toBe(1);
      expect(result.symbols).toBeGreaterThan(0);
    });

    it('should skip node_modules and other excluded dirs', async () => {
      createTestFile('app.ts', 'export function app() {}\n');
      const nmDir = join(TEST_DIR, 'node_modules', 'pkg');
      mkdirSync(nmDir, { recursive: true });
      writeFileSync(join(nmDir, 'index.js'), 'module.exports = {};\n', 'utf-8');

      const indexer = new CodeIndexer(TEST_DIR);
      const result = await indexer.buildIndex();

      expect(result.files).toBe(1);
    });

    it('should index multiple files', async () => {
      createTestFile('a.ts', 'export function funcA() {}\n');
      createTestFile('b.ts', 'export function funcB() {}\n');

      const indexer = new CodeIndexer(TEST_DIR);
      const result = await indexer.buildIndex();

      expect(result.files).toBe(2);
      expect(result.symbols).toBeGreaterThanOrEqual(2);
    });

    it('should detect exported symbols', async () => {
      createTestFile('exports.ts', `
export function exportedFunc() {}
function internalFunc() {}
export class ExportedClass {}
class InternalClass {}
`);

      const indexer = new CodeIndexer(TEST_DIR);
      await indexer.buildIndex();

      const exportedDefs = indexer.query({ type: 'symbol', name: 'exportedFunc' });
      expect(exportedDefs.matches.length).toBeGreaterThan(0);
      const def = exportedDefs.matches[0] as SymbolDef;
      expect(def.exported).toBe(true);

      const internalDefs = indexer.query({ type: 'symbol', name: 'internalFunc' });
      if (internalDefs.matches.length > 0) {
        const intDef = internalDefs.matches[0] as SymbolDef;
        expect(intDef.exported).toBe(false);
      }
    });
  });

  describe('query', () => {
    it('should find symbol by name', async () => {
      createTestFile('query.ts', 'export function findMe() {}\n');

      const indexer = new CodeIndexer(TEST_DIR);
      await indexer.buildIndex();

      const result = indexer.query({ type: 'symbol', name: 'findMe' });
      expect(result.total).toBeGreaterThan(0);
      expect(result.matches[0].name).toBe('findMe');
    });

    it('should find symbol by kind', async () => {
      createTestFile('kind.ts', 'export function myFunc() {}\nexport class MyClass {}\n');

      const indexer = new CodeIndexer(TEST_DIR);
      await indexer.buildIndex();

      const funcResult = indexer.query({ type: 'symbol', name: 'myFunc', kind: 'function' });
      expect(funcResult.matches.length).toBeGreaterThan(0);

      const classResult = indexer.query({ type: 'symbol', name: 'MyClass', kind: 'class' });
      expect(classResult.matches.length).toBeGreaterThan(0);
    });

    it('should search symbols by pattern', async () => {
      createTestFile('search.ts', `
export function getUser() {}
export function getUserById() {}
export function deleteUser() {}
`);

      const indexer = new CodeIndexer(TEST_DIR);
      await indexer.buildIndex();

      const result = indexer.query({ type: 'search', pattern: 'User' });
      expect(result.total).toBeGreaterThanOrEqual(3);
    });

    it('should return file outline', async () => {
      createTestFile('outline.ts', `
export function funcA() {}
export function funcB() {}
export class ClassA {}
`);

      const indexer = new CodeIndexer(TEST_DIR);
      await indexer.buildIndex();

      const result = indexer.query({ type: 'outline', filePath: 'outline.ts' });
      expect(result.total).toBeGreaterThanOrEqual(3);
    });

    it('should return empty results for unknown symbol', async () => {
      createTestFile('empty.ts', 'const x = 1;\n');

      const indexer = new CodeIndexer(TEST_DIR);
      await indexer.buildIndex();

      const result = indexer.query({ type: 'symbol', name: 'nonexistent' });
      expect(result.total).toBe(0);
    });

    it('should respect limit parameter', async () => {
      createTestFile('limit.ts', `
export function func1() {}
export function func2() {}
export function func3() {}
`);

      const indexer = new CodeIndexer(TEST_DIR);
      await indexer.buildIndex();

      const result = indexer.query({ type: 'search', pattern: 'func', limit: 2 });
      expect(result.matches.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getStats', () => {
    it('should return index statistics', async () => {
      createTestFile('stats.ts', 'export function testFunc() {}\n');

      const indexer = new CodeIndexer(TEST_DIR);
      await indexer.buildIndex();

      const stats = indexer.getStats();
      expect(stats.files).toBe(1);
      expect(stats.symbols).toBeGreaterThan(0);
      expect(stats.updatedAt).toBeGreaterThan(0);
    });
  });

  describe('import references', () => {
    it('should track import references', async () => {
      createTestFile('source.ts', 'export function importedFunc() {}\n');
      createTestFile('consumer.ts', 'import { importedFunc } from "./source.js";\nimportedFunc();\n');

      const indexer = new CodeIndexer(TEST_DIR);
      await indexer.buildIndex();

      const refs = indexer.query({ type: 'references', name: 'importedFunc' });
      expect(refs.total).toBeGreaterThan(0);
    });
  });
});

describe('codeIndexTool', () => {
  it('should have correct definition', async () => {
    const { codeIndexTool } = await import('../../src/tools/code-index.js');
    expect(codeIndexTool.definition.name).toBe('code_index');
    expect(codeIndexTool.definition.parameters.required).toEqual(['action']);
  });

  it('should build index via tool', async () => {
    createTestFile('tool-test.ts', 'export function toolTest() {}\n');

    const { codeIndexTool } = await import('../../src/tools/code-index.js');
    const result = await codeIndexTool.execute({
      action: 'build',
      root_dir: TEST_DIR,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Index built');
  });

  it('should query symbols via tool', async () => {
    createTestFile('query-test.ts', 'export function queryTest() {}\n');

    const { codeIndexTool } = await import('../../src/tools/code-index.js');
    await codeIndexTool.execute({ action: 'build', root_dir: TEST_DIR });

    const result = await codeIndexTool.execute({
      action: 'query',
      query_type: 'symbol',
      name: 'queryTest',
      root_dir: TEST_DIR,
    });

    expect(result.success).toBe(true);
  });

  it('should return stats via tool', async () => {
    createTestFile('stats-test.ts', 'export function statsTest() {}\n');

    const { codeIndexTool } = await import('../../src/tools/code-index.js');
    await codeIndexTool.execute({ action: 'build', root_dir: TEST_DIR });

    const result = await codeIndexTool.execute({
      action: 'stats',
      root_dir: TEST_DIR,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Index stats');
  });

  it('should return outline via tool', async () => {
    createTestFile('outline-test.ts', 'export function outlineTest() {}\n');

    const { codeIndexTool } = await import('../../src/tools/code-index.js');
    await codeIndexTool.execute({ action: 'build', root_dir: TEST_DIR });

    const result = await codeIndexTool.execute({
      action: 'outline',
      file_path: 'outline-test.ts',
      root_dir: TEST_DIR,
    });

    expect(result.success).toBe(true);
  });

  it('should reject build without root_dir', async () => {
    const { codeIndexTool } = await import('../../src/tools/code-index.js');
    const result = await codeIndexTool.execute({ action: 'build' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_params');
  });

  it('should reject query without required params', async () => {
    const { codeIndexTool } = await import('../../src/tools/code-index.js');
    const result = await codeIndexTool.execute({ action: 'query' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_params');
  });

  it('should reject outline without file_path', async () => {
    const { codeIndexTool } = await import('../../src/tools/code-index.js');
    const result = await codeIndexTool.execute({ action: 'outline' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_params');
  });
});