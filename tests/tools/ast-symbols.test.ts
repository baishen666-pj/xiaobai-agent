import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractSymbolsAST } from '../../src/tools/ast-symbols.js';

vi.mock('../../src/tools/tree-sitter-loader.js', () => {
  function makeNode(type: string, text: string, children: any[] = [], fields: Record<string, any> = {}) {
    return {
      type,
      text,
      children,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: text.length },
      childForFieldName: (name: string) => fields[name] ?? null,
      ...fields,
    };
  }

  const mockTrees = new Map<string, any>();

  return {
    parseFile: vi.fn(async (filePath: string) => mockTrees.get(filePath) ?? null),
    getLanguageId: vi.fn((filePath: string) => {
      if (filePath.endsWith('.ts')) return 'typescript';
      if (filePath.endsWith('.py')) return 'python';
      return null;
    }),
    __mockTrees: mockTrees,
    __makeNode: makeNode,
  };
});

const { __mockTrees, __makeNode } = vi.mocked(
  await import('../../src/tools/tree-sitter-loader.js')
) as any;

const makeNode = __makeNode as typeof __makeNode;

beforeEach(() => {
  __mockTrees.clear();
});

describe('extractSymbolsAST', () => {
  it('extracts function declarations', async () => {
    const nameNode = makeNode('identifier', 'greet', [], { text: 'greet', startPosition: { row: 0, column: 9 } });
    const funcNode = makeNode('function_declaration', 'function greet() {}', [nameNode], { name: nameNode });
    const root = makeNode('program', '', [funcNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST('function greet() {}', 'test.ts', 'test.ts');
    expect(result).not.toBeNull();
    expect(result!.symbols).toHaveLength(1);
    expect(result!.symbols[0].name).toBe('greet');
    expect(result!.symbols[0].kind).toBe('function');
  });

  it('extracts exported functions', async () => {
    const nameNode = makeNode('identifier', 'exported', [], { text: 'exported', startPosition: { row: 0, column: 16 } });
    const funcNode = makeNode('function_declaration', 'export function exported() {}', [nameNode], { name: nameNode });
    const exportNode = makeNode('export_statement', 'export function exported() {}', [funcNode]);
    funcNode.parent = exportNode;
    const root = makeNode('program', '', [exportNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST('export function exported() {}', 'test.ts', 'test.ts');
    expect(result!.symbols[0].exported).toBe(true);
  });

  it('extracts class declarations', async () => {
    const nameNode = makeNode('identifier', 'MyClass', [], { text: 'MyClass', startPosition: { row: 0, column: 6 } });
    const bodyNode = makeNode('class_body', '{}', []);
    const classNode = makeNode('class_declaration', 'class MyClass {}', [nameNode, bodyNode], { name: nameNode, body: bodyNode });
    const root = makeNode('program', '', [classNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST('class MyClass {}', 'test.ts', 'test.ts');
    expect(result!.symbols).toHaveLength(1);
    expect(result!.symbols[0].kind).toBe('class');
    expect(result!.symbols[0].name).toBe('MyClass');
  });

  it('extracts class methods', async () => {
    const classNameNode = makeNode('identifier', 'Foo', [], { text: 'Foo', startPosition: { row: 0, column: 6 } });
    const methodNameNode = makeNode('property_identifier', 'bar', [], { text: 'bar', startPosition: { row: 1, column: 2 } });
    const methodNode = makeNode('method_definition', 'bar() {}', [methodNameNode], { name: methodNameNode });
    const bodyNode = makeNode('class_body', '{ bar() {} }', [methodNode]);
    const classNode = makeNode('class_declaration', 'class Foo { bar() {} }', [classNameNode, bodyNode], { name: classNameNode, body: bodyNode });
    methodNode.parent = bodyNode;
    const root = makeNode('program', '', [classNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST('class Foo { bar() {} }', 'test.ts', 'test.ts');
    const methods = result!.symbols.filter((s) => s.kind === 'method');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('bar');
    expect(methods[0].parent).toBe('Foo');
  });

  it('extracts interface declarations', async () => {
    const nameNode = makeNode('identifier', 'IConfig', [], { text: 'IConfig', startPosition: { row: 0, column: 10 } });
    const bodyNode = makeNode('object_type', '{}', []);
    const ifaceNode = makeNode('interface_declaration', 'interface IConfig {}', [nameNode, bodyNode], { name: nameNode, body: bodyNode });
    const root = makeNode('program', '', [ifaceNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST('interface IConfig {}', 'test.ts', 'test.ts');
    expect(result!.symbols[0].kind).toBe('interface');
    expect(result!.symbols[0].name).toBe('IConfig');
  });

  it('extracts type alias declarations', async () => {
    const nameNode = makeNode('identifier', 'UserId', [], { text: 'UserId', startPosition: { row: 0, column: 5 } });
    const valueNode = makeNode('type_identifier', 'string', []);
    const typeNode = makeNode('type_alias_declaration', 'type UserId = string', [nameNode, valueNode], { name: nameNode, value: valueNode });
    const root = makeNode('program', '', [typeNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST('type UserId = string', 'test.ts', 'test.ts');
    expect(result!.symbols[0].kind).toBe('type');
  });

  it('extracts enum declarations', async () => {
    const nameNode = makeNode('identifier', 'Color', [], { text: 'Color', startPosition: { row: 0, column: 5 } });
    const bodyNode = makeNode('enum_body', '{ Red, Green }', []);
    const enumNode = makeNode('enum_declaration', 'enum Color { Red, Green }', [nameNode, bodyNode], { name: nameNode, body: bodyNode });
    const root = makeNode('program', '', [enumNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST('enum Color { Red, Green }', 'test.ts', 'test.ts');
    expect(result!.symbols[0].kind).toBe('enum');
  });

  it('extracts variable declarations', async () => {
    const nameNode = makeNode('identifier', 'count', [], { text: 'count', startPosition: { row: 0, column: 6 } });
    const valueNode = makeNode('number', '0', []);
    const declaratorNode = makeNode('variable_declarator', 'count = 0', [nameNode, valueNode], { name: nameNode });
    const declNode = makeNode('lexical_declaration', 'const count = 0', [declaratorNode]);
    const root = makeNode('program', '', [declNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST('const count = 0', 'test.ts', 'test.ts');
    expect(result!.symbols[0].kind).toBe('variable');
    expect(result!.symbols[0].name).toBe('count');
  });

  it('extracts import references', async () => {
    const sourceTextNode = makeNode('string', "'./utils'", [], { text: "'./utils'" });
    const importNameNode = makeNode('identifier', 'helper', [], { text: 'helper' });
    const clauseNode = makeNode('import_clause', '{ helper }', [importNameNode]);
    const importNode = makeNode('import_statement', "import { helper } from './utils'", [clauseNode, sourceTextNode], { source: sourceTextNode });
    const root = makeNode('program', '', [importNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST("import { helper } from './utils'", 'test.ts', 'test.ts');
    expect(result!.references).toHaveLength(1);
    expect(result!.references[0].name).toBe('helper');
    expect(result!.references[0].kind).toBe('import');
  });

  it('returns null when parser returns null', async () => {
    __mockTrees.set('unknown.xyz', null as any);

    const result = await extractSymbolsAST('code', 'unknown.xyz', 'unknown.xyz');
    expect(result).toBeNull();
  });

  it('handles generator functions', async () => {
    const nameNode = makeNode('identifier', 'gen', [], { text: 'gen', startPosition: { row: 0, column: 10 } });
    const funcNode = makeNode('generator_function_declaration', 'function* gen() {}', [nameNode], { name: nameNode });
    const root = makeNode('program', '', [funcNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST('function* gen() {}', 'test.ts', 'test.ts');
    expect(result!.symbols[0].kind).toBe('function');
    expect(result!.symbols[0].name).toBe('gen');
  });

  it('extracts named imports with specifiers', async () => {
    const sourceTextNode = makeNode('string', "'./mod'", [], { text: "'./mod'" });
    const specNameNode = makeNode('identifier', 'Foo', [], { text: 'Foo' });
    const specNode = makeNode('import_specifier', 'Foo', [specNameNode], { name: specNameNode });
    const namedImports = makeNode('named_imports', '{ Foo }', [specNode]);
    const clauseNode = makeNode('import_clause', '{ Foo }', [namedImports]);
    const importNode = makeNode('import_statement', "import { Foo } from './mod'", [clauseNode, sourceTextNode], { source: sourceTextNode });
    const root = makeNode('program', '', [importNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST("import { Foo } from './mod'", 'test.ts', 'test.ts');
    expect(result!.references).toHaveLength(1);
    expect(result!.references[0].name).toBe('Foo');
  });

  it('extracts namespace imports', async () => {
    const sourceTextNode = makeNode('string', "'./lib'", [], { text: "'./lib'" });
    const nsNameNode = makeNode('identifier', 'lib', [], { text: 'lib' });
    const nsNode = makeNode('namespace_import', '* as lib', [nsNameNode], { name: nsNameNode });
    const clauseNode = makeNode('import_clause', '* as lib', [nsNode]);
    const importNode = makeNode('import_statement', "import * as lib from './lib'", [clauseNode, sourceTextNode], { source: sourceTextNode });
    const root = makeNode('program', '', [importNode]);

    __mockTrees.set('test.ts', { rootNode: root });

    const result = await extractSymbolsAST("import * as lib from './lib'", 'test.ts', 'test.ts');
    expect(result!.references).toHaveLength(1);
    expect(result!.references[0].name).toBe('lib');
  });
});
