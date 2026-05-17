import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { definitionTool } from '../../src/tools/builtin-definition.js';
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
  TEST_DIR = join(tmpdir(), `xiaobai-def-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('definitionTool', () => {
  it('has correct definition', () => {
    expect(definitionTool.definition.name).toBe('go_to_definition');
    expect(definitionTool.definition.parameters.required).toEqual(['file_path', 'line', 'column']);
  });

  it('returns error for unsupported file type', async () => {
    const result = await definitionTool.execute({ file_path: 'test.py', line: 1, column: 1 });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unsupported file type');
  });

  it('returns error when file cannot be read', async () => {
    const result = await definitionTool.execute({ file_path: '/nonexistent.ts', line: 1, column: 1 });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Cannot read file');
  });

  it('returns error when parser returns null', async () => {
    const filePath = join(TEST_DIR, 'test.ts');
    writeFileSync(filePath, 'const x = 1;');
    (parseFile as any).mockResolvedValueOnce(null);

    const result = await definitionTool.execute({ file_path: filePath, line: 1, column: 1 });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Cannot parse file');
  });

  it('finds definition of a function', async () => {
    const filePath = join(TEST_DIR, 'def.ts');
    writeFileSync(filePath, 'function greet() {} greet();');

    const identNode = {
      type: 'identifier',
      text: 'greet',
      startPosition: { row: 0, column: 20 },
      parent: { type: 'call_expression' },
    };
    const declNameNode = { type: 'identifier', text: 'greet', startPosition: { row: 0, column: 9 } };
    const declNode = {
      type: 'function_declaration',
      children: [declNameNode],
      childForFieldName: (n: string) => n === 'name' ? declNameNode : null,
    };
    const rootNode = {
      type: 'program',
      children: [declNode, identNode],
      descendantForPosition: () => identNode,
      childForFieldName: () => null,
    };
    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await definitionTool.execute({ file_path: filePath, line: 1, column: 21 });
    expect(result.success).toBe(true);
    expect(result.output).toContain('greet');
    expect(result.metadata).toBeDefined();
  });

  it('returns error when no definition found', async () => {
    const filePath = join(TEST_DIR, 'nodef.ts');
    writeFileSync(filePath, 'foo();');

    const identNode = {
      type: 'identifier',
      text: 'foo',
      startPosition: { row: 0, column: 0 },
      parent: { type: 'call_expression' },
    };
    const rootNode = {
      type: 'program',
      children: [identNode],
      descendantForPosition: () => identNode,
      childForFieldName: () => null,
    };
    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await definitionTool.execute({ file_path: filePath, line: 1, column: 1 });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No definition found');
  });

  it('uses parent identifier when node is not identifier', async () => {
    const filePath = join(TEST_DIR, 'parent.ts');
    writeFileSync(filePath, 'foo.bar();');

    const propertyNode = {
      type: 'property_identifier',
      text: 'bar',
      startPosition: { row: 0, column: 4 },
      parent: {
        type: 'member_expression',
        childForFieldName: () => null,
        parent: {
          type: 'identifier',
          text: 'bar',
        },
      },
    };
    const rootNode = {
      type: 'program',
      children: [],
      descendantForPosition: () => propertyNode,
      childForFieldName: () => null,
    };
    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await definitionTool.execute({ file_path: filePath, line: 1, column: 5 });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No definition found');
  });
});
