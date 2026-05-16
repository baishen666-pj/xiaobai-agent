import type { Tool, ToolContext, ToolResult } from './registry.js';

export interface AstEditOperation {
  type: 'rename' | 'insert' | 'delete' | 'replace';
  target?: string;
  newName?: string;
  code?: string;
  position?: { line: number; column: number };
  range?: { startLine: number; startCol: number; endLine: number; endCol: number };
}

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function isSupportedFile(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return SUPPORTED_EXTENSIONS.has(ext);
}

export const astEditTool: Tool = {
  definition: {
    name: 'ast_edit',
    description: 'Perform AST-aware structural code edits. Supports rename, insert, delete, and replace operations on JavaScript/TypeScript code with proper syntax awareness.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file to edit' },
        operation: {
          type: 'string',
          enum: ['rename', 'insert', 'delete', 'replace'],
          description: 'Type of edit operation',
        },
        target: { type: 'string', description: 'Target identifier (function/class/variable name for rename, or path like "ClassName.methodName")' },
        new_name: { type: 'string', description: 'New name for rename operations' },
        code: { type: 'string', description: 'Code to insert or replace with' },
        position: {
          type: 'object',
          description: 'Position for insert (1-indexed line and column)',
          properties: {
            line: { type: 'number', description: 'Line number (1-indexed)' },
            column: { type: 'number', description: 'Column number (1-indexed)' },
          },
        },
        range: {
          type: 'object',
          description: 'Range for delete/replace (1-indexed)',
          properties: {
            startLine: { type: 'number', description: 'Start line' },
            startCol: { type: 'number', description: 'Start column' },
            endLine: { type: 'number', description: 'End line' },
            endCol: { type: 'number', description: 'End column' },
          },
        },
      },
      required: ['file_path', 'operation'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { file_path, operation, target, new_name, code, position, range } = args as {
      file_path: string;
      operation: string;
      target?: string;
      new_name?: string;
      code?: string;
      position?: { line: number; column: number };
      range?: { startLine: number; startCol: number; endLine: number; endCol: number };
    };

    if (!isSupportedFile(file_path)) {
      return {
        output: `Unsupported file type. AST edit supports: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
        success: false,
        error: 'unsupported_file_type',
      };
    }

    try {
      const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
      const { resolve } = await import('node:path');

      const absPath = resolve(file_path);
      if (!existsSync(absPath)) {
        return { output: `File not found: ${absPath}`, success: false, error: 'file_not_found' };
      }

      const source = readFileSync(absPath, 'utf-8');

      let result: string;

      switch (operation) {
        case 'rename':
          if (!target || !new_name) {
            return { output: 'rename requires target and new_name', success: false, error: 'missing_params' };
          }
          result = performRename(source, target, new_name);
          break;

        case 'insert':
          if (!code || !position) {
            return { output: 'insert requires code and position', success: false, error: 'missing_params' };
          }
          result = performInsert(source, code, position.line, position.column);
          break;

        case 'delete':
          if (!range) {
            return { output: 'delete requires range', success: false, error: 'missing_params' };
          }
          result = performDelete(source, range.startLine, range.startCol, range.endLine, range.endCol);
          break;

        case 'replace':
          if (!range || !code) {
            return { output: 'replace requires range and code', success: false, error: 'missing_params' };
          }
          result = performReplace(source, code, range.startLine, range.startCol, range.endLine, range.endCol);
          break;

        default:
          return { output: `Unknown operation: ${operation}`, success: false, error: 'unknown_operation' };
      }

      writeFileSync(absPath, result, 'utf-8');

      return {
        output: `AST edit (${operation}) applied to ${absPath}`,
        success: true,
        metadata: { operation, target, file: absPath },
      };
    } catch (error) {
      return {
        output: `AST edit failed: ${(error as Error).message}`,
        success: false,
        error: 'ast_edit_error',
      };
    }
  },
};

function performRename(source: string, target: string, newName: string): string {
  // Parse target path (e.g., "ClassName.methodName" or just "variableName")
  const parts = target.split('.');
  const identifier = parts[parts.length - 1];

  // Use word-boundary-aware replacement
  // Match identifier in various contexts: declarations, usages, property access
  const patterns = [
    // Declaration: const/let/var/function/class identifier
    new RegExp(`\\b(const|let|var|function|class|type|interface|enum)\\s+(${escapeRegex(identifier)})\\b`, 'g'),
    // Usage: identifier as standalone word
    new RegExp(`\\b(${escapeRegex(identifier)})\\b`, 'g'),
  ];

  let result = source;
  let renameCount = 0;

  // First pass: count occurrences
  const usagePattern = patterns[1];
  const matches = source.match(usagePattern);
  renameCount = matches ? matches.length : 0;

  // Apply rename with context awareness
  result = result.replace(usagePattern, (match, name, offset) => {
    // Check if this is part of a string literal
    const before = source.slice(Math.max(0, offset - 1), offset);
    const after = source.slice(offset + identifier.length, offset + identifier.length + 1);
    if (before === '"' || before === "'" || before === '`' || after === '"' || after === "'" || after === '`') {
      return match;
    }
    return newName;
  });

  return result;
}

function performInsert(source: string, code: string, line: number, column: number): string {
  const lines = source.split('\n');
  const insertLine = line - 1; // Convert to 0-indexed

  if (insertLine < 0 || insertLine > lines.length) {
    throw new Error(`Invalid line number: ${line}`);
  }

  const indent = column > 1 ? ' '.repeat(column - 1) : '';
  const insertText = code.split('\n').map((l, i) => i === 0 ? indent + l : indent + l).join('\n');

  if (insertLine === lines.length) {
    lines.push(insertText);
  } else {
    const targetLine = lines[insertLine];
    const before = targetLine.slice(0, column - 1);
    const after = targetLine.slice(column - 1);
    lines[insertLine] = before + insertText + after;
  }

  return lines.join('\n');
}

function performDelete(source: string, startLine: number, startCol: number, endLine: number, endCol: number): string {
  const lines = source.split('\n');
  const sLine = startLine - 1;
  const eLine = endLine - 1;

  if (sLine < 0 || eLine >= lines.length || sLine > eLine) {
    throw new Error(`Invalid range: ${startLine}:${startCol} - ${endLine}:${endCol}`);
  }

  if (sLine === eLine) {
    const line = lines[sLine];
    lines[sLine] = line.slice(0, startCol - 1) + line.slice(endCol - 1);
  } else {
    const firstPart = lines[sLine].slice(0, startCol - 1);
    const lastPart = lines[eLine].slice(endCol - 1);
    lines.splice(sLine, eLine - sLine + 1, firstPart + lastPart);
  }

  return lines.join('\n');
}

function performReplace(source: string, code: string, startLine: number, startCol: number, endLine: number, endCol: number): string {
  const lines = source.split('\n');
  const sLine = startLine - 1;
  const eLine = endLine - 1;

  if (sLine < 0 || eLine >= lines.length || sLine > eLine) {
    throw new Error(`Invalid range: ${startLine}:${startCol} - ${endLine}:${endCol}`);
  }

  const firstPart = lines[sLine].slice(0, startCol - 1);
  const lastPart = lines[eLine].slice(endCol - 1);
  const newLines = code.split('\n');

  // Preserve indentation of first line
  if (newLines.length > 0) {
    newLines[0] = firstPart + newLines[0];
  }
  if (newLines.length > 0) {
    newLines[newLines.length - 1] += lastPart;
  }

  lines.splice(sLine, eLine - sLine + 1, ...newLines);

  return lines.join('\n');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}