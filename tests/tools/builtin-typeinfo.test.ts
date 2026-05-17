import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { typeInfoTool } from '../../src/tools/builtin-typeinfo.js';
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
  TEST_DIR = join(tmpdir(), `xiaobai-typeinfo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('typeInfoTool', () => {
  it('has correct definition', () => {
    expect(typeInfoTool.definition.name).toBe('type_info');
    expect(typeInfoTool.definition.parameters.required).toEqual(['file_path', 'symbol']);
  });

  it('returns error for unsupported file type', async () => {
    const result = await typeInfoTool.execute({ file_path: 'test.xyz', symbol: 'Foo' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unsupported file type');
  });

  it('returns error when file cannot be read', async () => {
    const result = await typeInfoTool.execute({ file_path: '/nonexistent/file.ts', symbol: 'Foo' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Cannot read file');
  });

  it('returns error when parser returns null', async () => {
    const filePath = join(TEST_DIR, 'test.ts');
    writeFileSync(filePath, 'interface Foo {}');
    (parseFile as any).mockResolvedValueOnce(null);

    const result = await typeInfoTool.execute({ file_path: filePath, symbol: 'Foo' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Cannot parse file');
  });

  it('returns error when symbol not found', async () => {
    const filePath = join(TEST_DIR, 'nosymbol.ts');
    writeFileSync(filePath, 'const x = 1;');

    const mockRoot = {
      type: 'program',
      children: [],
      childForFieldName: () => null,
    };
    (parseFile as any).mockResolvedValueOnce({ rootNode: mockRoot });

    const result = await typeInfoTool.execute({ file_path: filePath, symbol: 'NonExistent' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No type info found');
  });

  it('extracts interface type info', async () => {
    const filePath = join(TEST_DIR, 'iface.ts');
    writeFileSync(filePath, 'interface MyConfig { name: string; age?: number; }');

    const propNameNode = { type: 'property_identifier', text: 'name', startPosition: { row: 0, column: 0 } };
    const propTypeNode = { type: 'type_annotation', text: ': string', children: [] };
    const propNode = { type: 'property_signature', children: [propNameNode, propTypeNode, { type: '?' }], childForFieldName: (n: string) => n === 'name' ? propNameNode : n === 'type' ? propTypeNode : null };

    const bodyNode = { children: [propNode] };
    const nameNode = { type: 'identifier', text: 'MyConfig' };
    const ifaceNode = {
      type: 'interface_declaration',
      children: [nameNode, bodyNode],
      childForFieldName: (n: string) => n === 'name' ? nameNode : n === 'body' ? bodyNode : null,
    };
    const rootNode = { type: 'program', children: [ifaceNode], childForFieldName: () => null };

    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await typeInfoTool.execute({ file_path: filePath, symbol: 'MyConfig' });
    expect(result.success).toBe(true);
    const info = JSON.parse(result.output);
    expect(info.kind).toBe('interface');
    expect(info.name).toBe('MyConfig');
  });

  it('extracts function type info', async () => {
    const filePath = join(TEST_DIR, 'func.ts');
    writeFileSync(filePath, 'function greet(name: string): string { return name; }');

    const paramNameNode = { type: 'identifier', text: 'name' };
    const paramTypeNode = { type: 'type_annotation', text: ': string' };
    const paramNode = {
      type: 'required_parameter',
      children: [paramNameNode],
      childForFieldName: (n: string) => n === 'name' ? paramNameNode : n === 'type' ? paramTypeNode : null,
    };
    const paramsNode = { children: [paramNode] };
    const returnTypeNode = { text: ': string' };
    const nameNode = { type: 'identifier', text: 'greet' };
    const funcNode = {
      type: 'function_declaration',
      children: [nameNode],
      childForFieldName: (n: string) => n === 'name' ? nameNode : n === 'parameters' ? paramsNode : n === 'return_type' ? returnTypeNode : null,
    };
    const rootNode = { type: 'program', children: [funcNode], childForFieldName: () => null };

    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await typeInfoTool.execute({ file_path: filePath, symbol: 'greet' });
    expect(result.success).toBe(true);
    const info = JSON.parse(result.output);
    expect(info.kind).toBe('function');
    expect(info.parameters).toHaveLength(1);
    expect(info.parameters[0].name).toBe('name');
  });

  it('extracts class type info', async () => {
    const filePath = join(TEST_DIR, 'cls.ts');
    writeFileSync(filePath, 'class Dog { bark() {} }');

    const methodNameNode = { type: 'property_identifier', text: 'bark' };
    const methodNode = {
      type: 'method_definition',
      children: [methodNameNode],
      childForFieldName: (n: string) => n === 'name' ? methodNameNode : null,
    };
    const bodyNode = { children: [methodNode] };
    const nameNode = { type: 'identifier', text: 'Dog' };
    const classNode = {
      type: 'class_declaration',
      children: [nameNode, bodyNode],
      childForFieldName: (n: string) => n === 'name' ? nameNode : n === 'body' ? bodyNode : null,
    };
    const rootNode = { type: 'program', children: [classNode], childForFieldName: () => null };

    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await typeInfoTool.execute({ file_path: filePath, symbol: 'Dog' });
    expect(result.success).toBe(true);
    const info = JSON.parse(result.output);
    expect(info.kind).toBe('class');
  });

  it('extracts type alias info', async () => {
    const filePath = join(TEST_DIR, 'alias.ts');
    writeFileSync(filePath, 'type Id = string;');

    const valueNode = { type: 'type_identifier', text: 'string' };
    const nameNode = { type: 'identifier', text: 'Id' };
    const aliasNode = {
      type: 'type_alias_declaration',
      children: [nameNode, valueNode],
      childForFieldName: (n: string) => n === 'name' ? nameNode : n === 'value' ? valueNode : null,
    };
    const rootNode = { type: 'program', children: [aliasNode], childForFieldName: () => null };

    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await typeInfoTool.execute({ file_path: filePath, symbol: 'Id' });
    expect(result.success).toBe(true);
    const info = JSON.parse(result.output);
    expect(info.kind).toBe('type');
    expect(info.properties[0].name).toBe('definition');
  });

  it('extracts enum info', async () => {
    const filePath = join(TEST_DIR, 'enum.ts');
    writeFileSync(filePath, 'enum Color { Red, Green }');

    const memberNode = { type: 'enum_assignment', text: 'Red', childForFieldName: () => ({ text: 'Red' }) };
    const bodyNode = { children: [memberNode] };
    const nameNode = { type: 'identifier', text: 'Color' };
    const enumNode = {
      type: 'enum_declaration',
      children: [nameNode, bodyNode],
      childForFieldName: (n: string) => n === 'name' ? nameNode : n === 'body' ? bodyNode : null,
    };
    const rootNode = { type: 'program', children: [enumNode], childForFieldName: () => null };

    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await typeInfoTool.execute({ file_path: filePath, symbol: 'Color' });
    expect(result.success).toBe(true);
    const info = JSON.parse(result.output);
    expect(info.kind).toBe('enum');
  });

  it('handles unknown declaration types', async () => {
    const filePath = join(TEST_DIR, 'unknown.ts');
    writeFileSync(filePath, 'const x = 1;');

    const nameNode = { type: 'identifier', text: 'x' };
    const declNode = {
      type: 'lexical_declaration',
      children: [nameNode],
      childForFieldName: (n: string) => n === 'name' ? nameNode : null,
    };
    const rootNode = { type: 'program', children: [declNode], childForFieldName: () => null };

    (parseFile as any).mockResolvedValueOnce({ rootNode });

    const result = await typeInfoTool.execute({ file_path: filePath, symbol: 'x' });
    expect(result.success).toBe(true);
    const info = JSON.parse(result.output);
    expect(info.name).toBe('x');
  });
});
