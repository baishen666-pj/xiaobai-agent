import * as fs from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './registry.js';
import { truncate, isPathSafe, isBinaryContent } from './builtin-shell.js';

const fsp = fs.promises;
const exists = (p: string) => fsp.access(p).then(() => true, () => false);

export const readTool = (context?: ToolContext): Tool => ({
  definition: {
    name: 'read',
    description: 'Read file contents from the local filesystem',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        offset: { type: 'number', description: 'Start line number (0-indexed)' },
        limit: { type: 'number', description: 'Max lines to read', default: 2000 },
      },
      required: ['file_path'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { file_path, offset = 0, limit = 2000 } = args as {
      file_path: string;
      offset?: number;
      limit?: number;
    };

    const absPath = resolve(file_path);
    if (!isAbsolute(file_path)) {
      return { output: 'Only absolute paths are allowed', success: false, error: 'invalid_path' };
    }

    if (!isPathSafe(absPath)) {
      return { output: `Access denied: path outside allowed scope`, success: false, error: 'path_unsafe' };
    }

    if (!(await exists(absPath))) {
      return { output: `File not found: ${absPath}`, success: false, error: 'file_not_found' };
    }

    const fileStat = await fsp.stat(absPath);
    if (fileStat.isDirectory()) {
      try {
        const entries = await fsp.readdir(absPath);
        return { output: entries.join('\n'), success: true };
      } catch (error) {
        return { output: `Cannot read directory: ${(error as Error).message}`, success: false, error: 'read_error' };
      }
    }

    if (fileStat.size > 10 * 1024 * 1024) {
      return { output: `File too large: ${fileStat.size} bytes (max 10MB)`, success: false, error: 'file_too_large' };
    }

    try {
      const content = await fsp.readFile(absPath, 'utf-8');

      if (isBinaryContent(content)) {
        return {
          output: `Binary file (${fileStat.size} bytes). Use bash tool for binary inspection.`,
          success: true,
          metadata: { size: fileStat.size, binary: true },
        };
      }

      const lines = content.split('\n');
      const selected = lines.slice(offset, offset + limit);
      const numbered = selected.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');
      return { output: numbered, success: true };
    } catch (error) {
      return { output: `Read failed: ${(error as Error).message}`, success: false, error: 'read_error' };
    }
  },
});

export const writeTool = (context?: ToolContext): Tool => ({
  definition: {
    name: 'write',
    description: 'Write content to a file, creating it if it does not exist',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['file_path', 'content'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { file_path, content } = args as { file_path: string; content: string };

    const absPath = resolve(file_path);
    if (!isAbsolute(file_path)) {
      return { output: 'Only absolute paths are allowed', success: false, error: 'invalid_path' };
    }

    if (!isPathSafe(absPath)) {
      return { output: `Access denied: path outside allowed scope`, success: false, error: 'path_unsafe' };
    }

    if (context?.sandbox && !context.sandbox.canWrite(absPath, process.cwd())) {
      return { output: `Write denied by sandbox policy: ${absPath}`, success: false, error: 'sandbox_denied' };
    }

    try {
      const dir = join(absPath, '..');
      if (!(await exists(dir))) await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(absPath, content, 'utf-8');
      return {
        output: `Wrote ${content.length} chars to ${absPath}`,
        success: true,
        metadata: { path: absPath, size: content.length },
      };
    } catch (error) {
      return { output: `Write failed: ${(error as Error).message}`, success: false, error: 'write_error' };
    }
  },
});

export const editTool = (context?: ToolContext): Tool => ({
  definition: {
    name: 'edit',
    description: 'Perform exact string replacement in a file',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        old_string: { type: 'string', description: 'Text to replace' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences', default: false },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { file_path, old_string, new_string, replace_all = false } = args as {
      file_path: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    };

    const absPath = resolve(file_path);
    if (!isAbsolute(file_path)) {
      return { output: 'Only absolute paths are allowed', success: false, error: 'invalid_path' };
    }

    if (!isPathSafe(absPath)) {
      return { output: `Access denied: path outside allowed scope`, success: false, error: 'path_unsafe' };
    }

    if (!(await exists(absPath))) {
      return { output: `File not found: ${absPath}`, success: false, error: 'file_not_found' };
    }

    if (context?.sandbox && !context.sandbox.canWrite(absPath, process.cwd())) {
      return { output: `Edit denied by sandbox policy: ${absPath}`, success: false, error: 'sandbox_denied' };
    }

    try {
      let content = await fsp.readFile(absPath, 'utf-8');

      if (!content.includes(old_string)) {
        return { output: 'old_string not found in file', success: false, error: 'match_not_found' };
      }

      if (!replace_all) {
        const count = content.split(old_string).length - 1;
        if (count > 1) {
          return {
            output: `Found ${count} matches. Use replace_all=true or provide more context.`,
            success: false,
            error: 'ambiguous_match',
          };
        }
      }

      const oldCount = content.split(old_string).length - 1;
      content = replace_all ? content.replaceAll(old_string, new_string) : content.replace(old_string, new_string);
      await fsp.writeFile(absPath, content, 'utf-8');

      return {
        output: `Edited ${absPath} (${oldCount} replacement${oldCount > 1 ? 's' : ''})`,
        success: true,
      };
    } catch (error) {
      return { output: `Edit failed: ${(error as Error).message}`, success: false, error: 'edit_error' };
    }
  },
});