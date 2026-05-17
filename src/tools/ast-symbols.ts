import { parseFile } from './tree-sitter-loader.js';
import type { SymbolDef, SymbolRef } from './code-index.js';

export interface ASTExtractionResult {
  symbols: SymbolDef[];
  references: SymbolRef[];
}

export async function extractSymbolsAST(
  source: string,
  filePath: string,
  relPath: string,
): Promise<ASTExtractionResult | null> {
  const tree = await parseFile(filePath, source);
  if (!tree) return null;

  const symbols: SymbolDef[] = [];
  const references: SymbolRef[] = [];

  visitNode(tree.rootNode, relPath, source, null, symbols, references);

  return { symbols, references };
}

function visitNode(
  node: any,
  relPath: string,
  source: string,
  parentClass: string | null,
  symbols: SymbolDef[],
  references: SymbolRef[],
): void {
  const nodeType = node.type;

  if (nodeType === 'function_declaration' || nodeType === 'generator_function_declaration') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      const isExported = hasExportAncestor(node);
      symbols.push({
        name: nameNode.text,
        kind: 'function',
        filePath: relPath,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column,
        exported: isExported,
      });
    }
  } else if (nodeType === 'class_declaration') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      const isExported = hasExportAncestor(node);
      const className = nameNode.text;
      symbols.push({
        name: className,
        kind: 'class',
        filePath: relPath,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column,
        exported: isExported,
      });
      for (const child of node.children) {
        visitNode(child, relPath, source, className, symbols, references);
      }
      return;
    }
  } else if (nodeType === 'method_definition' || nodeType === 'function_expression') {
    const nameNode = findMethodName(node);
    if (nameNode && parentClass) {
      symbols.push({
        name: nameNode.text,
        kind: 'method',
        filePath: relPath,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column,
        exported: false,
        parent: parentClass,
      });
    }
  } else if (nodeType === 'interface_declaration') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      symbols.push({
        name: nameNode.text,
        kind: 'interface',
        filePath: relPath,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column,
        exported: hasExportAncestor(node),
      });
    }
  } else if (nodeType === 'type_alias_declaration') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      symbols.push({
        name: nameNode.text,
        kind: 'type',
        filePath: relPath,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column,
        exported: hasExportAncestor(node),
      });
    }
  } else if (nodeType === 'enum_declaration') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) {
      symbols.push({
        name: nameNode.text,
        kind: 'enum',
        filePath: relPath,
        line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column,
        exported: hasExportAncestor(node),
      });
    }
  } else if (nodeType === 'lexical_declaration' || nodeType === 'variable_declaration') {
    const isExported = hasExportAncestor(node);
    for (const child of node.children) {
      if (child.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name');
        if (nameNode && nameNode.type === 'identifier') {
          symbols.push({
            name: nameNode.text,
            kind: 'variable',
            filePath: relPath,
            line: nameNode.startPosition.row + 1,
        column: nameNode.startPosition.column,
            exported: isExported,
          });
        }
      }
    }
  } else if (nodeType === 'import_statement' || nodeType === 'import_declaration') {
    const sourceNode = node.childForFieldName('source');
    if (sourceNode) {
      const importedNames = extractImportNames(node);
      const sourcePath = sourceNode.text.replace(/['"]/g, '');
      for (const name of importedNames) {
        references.push({
          name,
          kind: 'import',
          filePath: relPath,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        });
      }
    }
  }

  for (const child of node.children) {
    visitNode(child, relPath, source, parentClass, symbols, references);
  }
}

function hasExportAncestor(node: any): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'export_statement') return true;
    current = current.parent;
  }
  return false;
}

function findMethodName(node: any): any | null {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode;
  // For computed property methods, skip
  return null;
}

function extractImportNames(importNode: any): string[] {
  const names: string[] = [];

  for (const child of importNode.children) {
    if (child.type === 'import_clause') {
      for (const clauseChild of child.children) {
        if (clauseChild.type === 'identifier') {
          names.push(clauseChild.text);
        } else if (clauseChild.type === 'named_imports') {
          for (const specifier of clauseChild.children) {
            if (specifier.type === 'import_specifier') {
              const nameNode = specifier.childForFieldName('name');
              if (nameNode) names.push(nameNode.text);
            }
          }
        } else if (clauseChild.type === 'namespace_import') {
          const nameNode = clauseChild.childForFieldName('name');
          if (nameNode) names.push(nameNode.text);
        }
      }
    }
  }

  return names;
}
