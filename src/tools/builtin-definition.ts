import { readFile } from 'node:fs/promises';
import { parseFile, getLanguageId } from './tree-sitter-loader.js';
import type { Tool, ToolResult } from './registry.js';

export const definitionTool: Tool = {
  definition: {
    name: 'go_to_definition',
    description: 'Find the definition of a symbol at a given position in a file.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File containing the symbol reference' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const filePath = args.file_path as string;
    const line = (args.line as number) - 1;
    const column = (args.column as number) - 1;

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

    const identifier = findIdentifierAt(node, source);
    if (!identifier) {
      return { output: 'No identifier found at position', success: false };
    }

    const definition = findDefinition(tree.rootNode, identifier, source);
    if (!definition) {
      return { output: `No definition found for: ${identifier}`, success: false };
    }

    return {
      output: `${definition.filePath ?? filePath}:${definition.line}:${definition.column + 1} — ${definition.kind}: ${identifier}`,
      success: true,
      metadata: definition,
    };
  },
};

function findIdentifierAt(node: any, source: string): string | null {
  if (node.type === 'identifier' || node.type === 'type_identifier' || node.type === 'property_identifier') {
    return node.text;
  }
  if (node.parent) {
    const parent = node.parent;
    if (parent.type === 'identifier' || parent.type === 'type_identifier' || parent.type === 'property_identifier') {
      return parent.text;
    }
  }
  return node.text ?? null;
}

function findDefinition(
  rootNode: any,
  identifier: string,
  source: string,
): { filePath?: string; line: number; column: number; kind: string } | null {
  const def = findDeclaration(rootNode, identifier);
  if (def) return def;
  return null;
}

function findDeclaration(node: any, name: string): { line: number; column: number; kind: string } | null {
  if (node.childForFieldName) {
    const nameField = node.childForFieldName('name');
    if (nameField && nameField.text === name) {
      return {
        line: nameField.startPosition.row + 1,
        column: nameField.startPosition.column,
        kind: node.type,
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
