import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { referencesTool } from '../../src/tools/builtin-references.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TEST_DIR: string;

vi.mock('../../src/tools/tree-sitter-loader.js', () => ({
  parseFile: vi.fn(async () => null),
  getLanguageId: vi.fn((fp: string) => {
    if (fp.endsWith('.ts')) return 'typescript';
    return null;
  }),
}));

const { parseFile } = vi.mocked(await import('../../src/tools/tree-sitter-loader.js'));

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `xiaobai-refs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('referencesTool', () => {
  it('has correct definition', () => {
    expect(referencesTool.definition.name).toBe('find_references');
    expect(referencesTool.definition.parameters.required).toEqual(['file_path', 'line', 'column']);
  });

  it('returns error for unsupported file type', async () => {
    const result = await referencesTool.execute({ file_path: 'test.py', line: 1, column: 1 });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unsupported file type');
  });

  it('returns error when file cannot be read', async () => {
    const result = await referencesTool.execute({ file_path: '/nonexistent.ts', line: 1, column: 1 });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Cannot read file');
  });

  it('returns error when parser returns null', async () => {
    const filePath = join(TEST_DIR, 'test.ts');
    writeFileSync(filePath, 'const x = 1;');
    (parseFile as any).mockResolvedValueOnce(null);

    const result = await referencesTool.execute({ file_path: filePath, line: 1, column: 1 });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Cannot parse file');
  });

  it('finds references to a symbol', async () => {
    const filePath = join(TEST_DIR, 'refs.ts');
    writeFileSync(filePath, 'function foo() {} const x = foo();');

    const refNode = {
      type: 'identifier',
      text: 'foo',
      startPosition: { row: 0, column: 28 },
      parent: { type: 'call_expression' },
    };
    const rootNode = {
      type: 'program',
      children: [refNode],
      descendantForPosition: () => refNode,
      childForFieldName: () => null,
    };
    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await referencesTool.execute({ file_path: filePath, line: 1, column: 29 });
    expect(result.success).toBe(true);
    expect(result.output).toContain('foo');
  });

  it('returns no identifier message when node is not identifier', async () => {
    const filePath = join(TEST_DIR, 'noid.ts');
    writeFileSync(filePath, '123');

    const mockNode = { type: 'number', text: '123', parent: null };
    const rootNode = {
      type: 'program',
      children: [],
      descendantForPosition: () => mockNode,
    };
    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await referencesTool.execute({ file_path: filePath, line: 1, column: 1 });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No identifier');
  });

  it('includes declaration when include_declaration is true', async () => {
    const filePath = join(TEST_DIR, 'decl.ts');
    writeFileSync(filePath, 'function foo() {} foo();');

    const refNode = {
      type: 'identifier',
      text: 'foo',
      startPosition: { row: 0, column: 18 },
      parent: { type: 'call_expression' },
    };
    const declNameNode = { type: 'identifier', text: 'foo', startPosition: { row: 0, column: 9 } };
    const declNode = {
      type: 'function_declaration',
      children: [declNameNode],
      childForFieldName: (n: string) => n === 'name' ? declNameNode : null,
    };
    const rootNode = {
      type: 'program',
      children: [declNode, refNode],
      descendantForPosition: () => refNode,
      childForFieldName: () => null,
    };
    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await referencesTool.execute({ file_path: filePath, line: 1, column: 19, include_declaration: true });
    expect(result.success).toBe(true);
    expect(result.output).toContain('declaration');
  });

  it('excludes declaration when include_declaration is false', async () => {
    const filePath = join(TEST_DIR, 'nodecl.ts');
    writeFileSync(filePath, 'function foo() {} foo();');

    const refNode = {
      type: 'identifier',
      text: 'foo',
      startPosition: { row: 0, column: 18 },
      parent: { type: 'call_expression' },
    };
    const rootNode = {
      type: 'program',
      children: [refNode],
      descendantForPosition: () => refNode,
      childForFieldName: () => null,
    };
    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await referencesTool.execute({ file_path: filePath, line: 1, column: 19, include_declaration: false });
    expect(result.success).toBe(true);
    expect(result.output).toContain('foo');
  });

  it('returns no references message when none found', async () => {
    const filePath = join(TEST_DIR, 'norefs.ts');
    writeFileSync(filePath, 'const bar = 1;');

    const identNode = {
      type: 'identifier',
      text: 'bar',
      startPosition: { row: 0, column: 6 },
      parent: { type: 'variable_declarator' },
    };
    const rootNode = {
      type: 'program',
      children: [identNode],
      descendantForPosition: () => identNode,
      childForFieldName: () => null,
    };
    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await referencesTool.execute({ file_path: filePath, line: 1, column: 7, include_declaration: false });
    expect(result.success).toBe(true);
    expect(result.output).toContain('No references found');
  });
});
