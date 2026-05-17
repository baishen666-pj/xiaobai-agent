import { readFile } from 'node:fs/promises';
import { parseFile, getLanguageId } from './tree-sitter-loader.js';
import type { Tool, ToolResult } from './registry.js';

export interface TypeInfo {
  name: string;
  kind: string;
  properties?: Array<{ name: string; type: string; optional: boolean }>;
  parameters?: Array<{ name: string; type: string; optional: boolean }>;
  returnType?: string;
  genericParams?: string[];
}

export const typeInfoTool: Tool = {
  definition: {
    name: 'type_info',
    description: 'Get TypeScript type information for a symbol.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File containing the symbol' },
        symbol: { type: 'string', description: 'Symbol name to look up' },
      },
      required: ['file_path', 'symbol'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const filePath = args.file_path as string;
    const symbolName = args.symbol as string;

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

    const info = extractTypeInfo(tree.rootNode, symbolName, source);
    if (!info) {
      return { output: `No type info found for: ${symbolName}`, success: false };
    }

    return {
      output: JSON.stringify(info, null, 2),
      success: true,
      metadata: info as unknown as Record<string, unknown>,
    };
  },
};

function extractTypeInfo(rootNode: any, symbolName: string, source: string): TypeInfo | null {
  const decl = findDeclarationNode(rootNode, symbolName);
  if (!decl) return null;

  const nodeType = decl.type;

  if (nodeType === 'interface_declaration') {
    return extractInterfaceInfo(decl, symbolName);
  }
  if (nodeType === 'type_alias_declaration') {
    return extractTypeInfoFromAlias(decl, symbolName);
  }
  if (nodeType === 'class_declaration') {
    return extractClassInfo(decl, symbolName);
  }
  if (nodeType === 'function_declaration' || nodeType === 'generator_function_declaration') {
    return extractFunctionInfo(decl, symbolName, source);
  }
  if (nodeType === 'enum_declaration') {
    return { name: symbolName, kind: 'enum', properties: extractEnumMembers(decl) };
  }

  return { name: symbolName, kind: nodeType };
}

function findDeclarationNode(node: any, name: string): any | null {
  if (node.childForFieldName) {
    const nameField = node.childForFieldName('name');
    if (nameField && nameField.text === name) {
      return node;
    }
  }
  if (node.children) {
    for (const child of node.children) {
      const result = findDeclarationNode(child, name);
      if (result) return result;
    }
  }
  return null;
}

function extractInterfaceInfo(node: any, name: string): TypeInfo {
  const body = node.childForFieldName('body');
  const properties: Array<{ name: string; type: string; optional: boolean }> = [];

  if (body) {
    for (const child of body.children) {
      if (child.type === 'property_signature') {
        const propName = child.childForFieldName('name')?.text ?? '';
        const typeAnn = child.childForFieldName('type');
        const propType = typeAnn ? typeAnn.text : 'unknown';
        const optional = child.children.some((c: any) => c.type === '?');
        properties.push({ name: propName, type: propType, optional });
      }
      if (child.type === 'method_signature') {
        const methodName = child.childForFieldName('name')?.text ?? '';
        properties.push({ name: methodName, type: 'method', optional: false });
      }
    }
  }

  const typeParams = extractTypeParameters(node);

  return { name, kind: 'interface', properties, genericParams: typeParams.length > 0 ? typeParams : undefined };
}

function extractClassInfo(node: any, name: string): TypeInfo {
  const body = node.childForFieldName('body');
  const properties: Array<{ name: string; type: string; optional: boolean }> = [];

  if (body) {
    for (const child of body.children) {
      if (child.type === 'method_definition') {
        const methodName = child.childForFieldName('name')?.text ?? '';
        properties.push({ name: methodName, type: 'method', optional: false });
      }
      if (child.type === 'public_field_definition' || child.type === 'field_definition') {
        const fieldName = child.childForFieldName('name')?.text ?? '';
        const typeAnn = child.childForFieldName('type');
        const fieldType = typeAnn ? typeAnn.text : 'unknown';
        const optional = child.children.some((c: any) => c.type === '?');
        properties.push({ name: fieldName, type: fieldType, optional });
      }
    }
  }

  const typeParams = extractTypeParameters(node);

  return { name, kind: 'class', properties, genericParams: typeParams.length > 0 ? typeParams : undefined };
}

function extractFunctionInfo(node: any, name: string, source: string): TypeInfo {
  const params = node.childForFieldName('parameters');
  const parameters: Array<{ name: string; type: string; optional: boolean }> = [];

  if (params) {
    for (const child of params.children) {
      if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
        const paramName = child.childForFieldName('name')?.text ?? '';
        const typeAnn = child.childForFieldName('type');
        const paramType = typeAnn ? typeAnn.text : 'any';
        const optional = child.type === 'optional_parameter';
        parameters.push({ name: paramName, type: paramType, optional });
      }
    }
  }

  const returnTypeNode = node.childForFieldName('return_type');
  const returnType = returnTypeNode ? returnTypeNode.text : undefined;

  const typeParams = extractTypeParameters(node);

  return {
    name,
    kind: 'function',
    parameters,
    returnType,
    genericParams: typeParams.length > 0 ? typeParams : undefined,
  };
}

function extractTypeInfoFromAlias(node: any, name: string): TypeInfo {
  const value = node.childForFieldName('value');
  const typeText = value ? value.text : 'unknown';

  const typeParams = extractTypeParameters(node);

  return {
    name,
    kind: 'type',
    properties: [{ name: 'definition', type: typeText, optional: false }],
    genericParams: typeParams.length > 0 ? typeParams : undefined,
  };
}

function extractEnumMembers(node: any): Array<{ name: string; type: string; optional: boolean }> {
  const body = node.childForFieldName('body');
  if (!body) return [];

  const members: Array<{ name: string; type: string; optional: boolean }> = [];
  for (const child of body.children) {
    if (child.type === 'enum_assignment' || child.type === 'property_identifier') {
      const memberName = child.childForFieldName('name')?.text ?? child.text;
      members.push({ name: memberName, type: 'enum_member', optional: false });
    }
  }
  return members;
}

function extractTypeParameters(node: any): string[] {
  const typeParams = node.childForFieldName('type_parameters');
  if (!typeParams) return [];

  const params: string[] = [];
  for (const child of typeParams.children) {
    if (child.type === 'type_identifier' || child.type === 'type_parameter') {
      const name = child.childForFieldName('name')?.text ?? child.text;
      if (name) params.push(name);
    }
  }
  return params;
}
