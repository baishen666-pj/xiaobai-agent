import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { glob } from 'node:fs/promises';
import type { Tool, ToolContext, ToolResult } from './registry.js';
import type { SecurityManager } from '../security/manager.js';
import type { ConfigManager } from '../config/manager.js';

const bashTool = (context?: ToolContext): Tool => ({
  definition: {
    name: 'bash',
    description: 'Execute a shell command and return its output',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 },
        cwd: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { command, timeout = 30000, cwd } = args as { command: string; timeout?: number; cwd?: string };
    try {
      const result = execSync(command, {
        timeout,
        cwd: cwd ?? process.cwd(),
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        shell: '/bin/bash',
      });
      return { output: result.slice(0, 50000), success: true };
    } catch (error: unknown) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      return {
        output: (e.stdout ?? '') + (e.stderr ?? '') + (e.message ?? ''),
        success: false,
        error: 'execution_failed',
      };
    }
  },
});

const readTool: Tool = {
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
    const { file_path, offset = 0, limit = 2000 } = args as { file_path: string; offset?: number; limit?: number };
    if (!existsSync(file_path)) {
      return { output: `File not found: ${file_path}`, success: false, error: 'file_not_found' };
    }
    try {
      const content = readFileSync(file_path, 'utf-8');
      const lines = content.split('\n');
      const selected = lines.slice(offset, offset + limit);
      const numbered = selected.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');
      return { output: numbered, success: true };
    } catch (error) {
      return { output: `Read failed: ${(error as Error).message}`, success: false, error: 'read_error' };
    }
  },
};

const writeTool: Tool = {
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
    try {
      const dir = join(file_path, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file_path, content, 'utf-8');
      return { output: `Wrote ${content.length} chars to ${file_path}`, success: true };
    } catch (error) {
      return { output: `Write failed: ${(error as Error).message}`, success: false, error: 'write_error' };
    }
  },
};

const editTool: Tool = {
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
    if (!existsSync(file_path)) {
      return { output: `File not found: ${file_path}`, success: false, error: 'file_not_found' };
    }
    try {
      let content = readFileSync(file_path, 'utf-8');
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
      content = replace_all
        ? content.replaceAll(old_string, new_string)
        : content.replace(old_string, new_string);
      writeFileSync(file_path, content, 'utf-8');
      return { output: `Edited ${file_path}`, success: true };
    } catch (error) {
      return { output: `Edit failed: ${(error as Error).message}`, success: false, error: 'edit_error' };
    }
  },
};

const grepTool: Tool = {
  definition: {
    name: 'grep',
    description: 'Search file contents using regex pattern (ripgrep-like)',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search' },
        path: { type: 'string', description: 'Directory or file to search' },
        glob: { type: 'string', description: 'File pattern filter (e.g. *.ts)' },
        output_mode: {
          type: 'string',
          enum: ['content', 'files', 'count'],
          description: 'Output format',
          default: 'files',
        },
      },
      required: ['pattern'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { pattern, path: searchPath = '.', glob: globPattern, output_mode = 'files' } = args as {
      pattern: string;
      path?: string;
      glob?: string;
      output_mode?: string;
    };
    try {
      let cmd = `rg --no-heading --color=never --max-count=500`;
      if (output_mode === 'files') cmd += ' -l';
      if (output_mode === 'count') cmd += ' -c';
      if (globPattern) cmd += ` --glob '${globPattern}'`;
      cmd += ` '${pattern.replace(/'/g, "\\'")}' '${searchPath}' 2>/dev/null || true`;

      const result = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 30000,
      });
      return { output: result.slice(0, 50000) || 'No matches found', success: true };
    } catch (error) {
      return { output: 'No matches found', success: true };
    }
  },
};

const globTool: Tool = {
  definition: {
    name: 'glob',
    description: 'Find files matching a glob pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. **/*.ts)' },
        path: { type: 'string', description: 'Directory to search in' },
      },
      required: ['pattern'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { pattern, path: searchPath = '.' } = args as { pattern: string; path?: string };
    try {
      const result = execSync(`find '${searchPath}' -name '${pattern}' -type f 2>/dev/null | head -250`, {
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 30000,
      });
      return { output: result.trim() || 'No files found', success: true };
    } catch {
      return { output: 'No files found', success: true };
    }
  },
};

const memoryTool: Tool = {
  definition: {
    name: 'memory',
    description: 'Manage persistent memory across sessions',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'replace', 'remove', 'list'], description: 'Action to perform' },
        target: { type: 'string', enum: ['memory', 'user'], description: 'Memory store target' },
        content: { type: 'string', description: 'Content to add or replace with' },
        old_text: { type: 'string', description: 'Substring to match for replace/remove' },
      },
      required: ['action', 'target'],
    },
  },
  async execute(args): Promise<ToolResult> {
    return { output: 'Memory operations handled by MemorySystem directly', success: true };
  },
};

const agentTool: Tool = {
  definition: {
    name: 'agent',
    description: 'Spawn a sub-agent with isolated context for parallel work',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Task description for the sub-agent' },
        type: {
          type: 'string',
          enum: ['explore', 'plan', 'general-purpose'],
          description: 'Agent type',
          default: 'general-purpose',
        },
      },
      required: ['prompt'],
    },
  },
  async execute(args): Promise<ToolResult> {
    return { output: 'Sub-agent execution requires running agent loop context', success: true };
  },
};

export function getBuiltinTools(context?: ToolContext): Tool[] {
  return [
    bashTool(context),
    readTool,
    writeTool,
    editTool,
    grepTool,
    globTool,
    memoryTool,
    agentTool,
  ];
}
