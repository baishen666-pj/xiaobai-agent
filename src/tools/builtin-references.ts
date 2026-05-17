import { readFile } from 'node:fs/promises';
import { parseFile, getLanguageId } from './tree-sitter-loader.js';
import type { Tool, ToolResult } from './registry.js';

export const referencesTool: Tool = {
  definition: {
    name: 'find_references',
    description: 'Find all references to a symbol at a given position in a file.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File containing the symbol' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
        include_declaration: { type: 'boolean', default: true, description: 'Include the declaration in results' },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const filePath = args.file_path as string;
    const line = (args.line as number) - 1;
    const column = (args.column as number) - 1;
    const includeDecl = (args.include_declaration as boolean) ?? true;

    const langId = getLanguageId(filePath);
    if (!langId) {
      return { output: `Unsupported file type: ${filePath}`, success: false };
    }

    let source: string;
    try {
      source = await readFile(filePath, 'utf-8');
    } catch {
      return { output: `Cannot read file: ${filePath}`, success: false };
    }

    const tree = await parseFile(filePath, source);
    if (!tree) {
      return { output: `Cannot parse file: ${filePath}`, success: false };
    }

    const node = tree.rootNode.descendantForPosition({ row: line, column });
    if (!node) {
      return { output: 'No node found at position', success: false };
    }

    const symbolName = node.type === 'identifier' || node.type === 'type_identifier'
      ? node.text
      : null;

    if (!symbolName) {
      return { output: 'No identifier at position', success: false };
    }

    const refs = findAllReferences(tree.rootNode, symbolName);

    const lines = refs.map((r) =>
      `${filePath}:${r.line}:${r.column + 1} — ${r.kind}`,
    );

    if (includeDecl) {
      const decl = findDeclaration(tree.rootNode, symbolName);
      if (decl) {
        lines.unshift(`${filePath}:${decl.line}:${decl.column + 1} — declaration`);
      }
    }

    if (lines.length === 0) {
      return { output: `No references found for: ${symbolName}`, success: true };
    }

    return {
      output: `Found ${lines.length} reference(s) to "${symbolName}":\n${lines.join('\n')}`,
      success: true,
      metadata: { symbol: symbolName, count: lines.length },
    };
  },
};

function findAllReferences(node: any, name: string): Array<{ line: number; column: number; kind: string }> {
  const results: Array<{ line: number; column: number; kind: string }> = [];

  if ((node.type === 'identifier' || node.type === 'type_identifier') && node.text === name) {
    const kind = isDeclarationContext(node) ? 'declaration' : 'reference';
    if (kind === 'reference') {
      results.push({
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        kind: 'reference',
      });
    }
  }

  if (node.children) {
    for (const child of node.children) {
      results.push(...findAllReferences(child, name));
    }
  }

  return results;
}

function isDeclarationContext(node: any): boolean {
  const parent = node.parent;
  if (!parent) return false;
  const declTypes = [
    'function_declaration', 'class_declaration', 'interface_declaration',
    'type_alias_declaration', 'enum_declaration', 'variable_declarator',
    'lexical_declaration', 'method_definition', 'import_specifier',
    'required_parameter', 'optional_parameter',
  ];
  return declTypes.includes(parent.type);
}

function findDeclaration(node: any, name: string): { line: number; column: number } | null {
  if (node.childForFieldName) {
    const nameField = node.childForFieldName('name');
    if (nameField && nameField.text === name) {
      return {
        line: nameField.startPosition.row + 1,
        column: nameField.startPosition.column,
      };
    }
  }
  if (node.children) {
    for (const child of node.children) {
      const result = findDeclaration(child, name);
      if (result) return result;
    }
  }
  return null;
}
