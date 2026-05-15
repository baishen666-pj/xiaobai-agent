// NOTE: Tools defined here can be migrated to individual files under src/tools/
// that call registry.registerSelf() for auto-registration. See registry.ts for details.
// The getBuiltinTools() function remains the canonical entry point for now.
import { spawn, execSync, execFileSync, type ChildProcess } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { readFile, writeFile, mkdir, stat, readdir, glob as asyncGlob } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { Tool, ToolContext, ToolResult } from './registry.js';

const MAX_OUTPUT = 50_000;
const IS_WIN = process.platform === 'win32';

function truncate(output: string, max = MAX_OUTPUT): string {
  if (output.length <= max) return output;
  const half = Math.floor(max / 2) - 20;
  return output.slice(0, half) + `\n\n... [truncated ${output.length - max} chars] ...\n\n` + output.slice(-half);
}

function isPathSafe(filePath: string, allowedDirs?: string[]): boolean {
  const normalized = normalize(resolve(filePath));
  if (!isAbsolute(normalized)) return false;
  if (allowedDirs?.length) {
    return allowedDirs.some((dir) => normalized.startsWith(normalize(resolve(dir)) + sep) || normalized === normalize(resolve(dir)));
  }
  return true;
}

function isBinaryContent(content: string): boolean {
  const sample = content.slice(0, 8192);
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) nullCount++;
    if (nullCount > 1) return true;
  }
  return false;
}

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
    const { command, timeout = 30000, cwd } = args as {
      command: string;
      timeout?: number;
      cwd?: string;
    };

    const workDir = cwd ?? process.cwd();

    if (context?.sandbox && !context.sandbox.canExecute(command)) {
      return { output: `Command blocked by sandbox policy: ${command}`, success: false, error: 'sandbox_denied' };
    }

    try {
      const result = await execStreaming(command, workDir, timeout);
      return { output: truncate(result), success: true };
    } catch (error: unknown) {
      const e = error as ExecError;
      return {
        output: truncate((e.stdout ?? '') + (e.stderr ?? '') + (e.message ?? '')),
        success: false,
        error: 'execution_failed',
      };
    }
  },
});

interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number;
  timedOut?: boolean;
}

function execStreaming(command: string, cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const shell = IS_WIN ? 'cmd.exe' : '/bin/bash';
    const shellArgs = IS_WIN ? ['/c', command] : ['-c', command];

    const child: ChildProcess = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const err: ExecError = new Error(`Command timed out after ${timeout}ms`);
      err.stdout = stdout;
      err.stderr = stderr;
      err.timedOut = true;
      reject(err);
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) {
        resolve(stdout + (stderr ? `\n[stderr]\n${stderr}` : ''));
      } else {
        const err: ExecError = new Error(`Exit code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code ?? undefined;
        reject(err);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin?.end();
  });
}

const readTool = (context?: ToolContext): Tool => ({
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

    if (!existsSync(absPath)) {
      return { output: `File not found: ${absPath}`, success: false, error: 'file_not_found' };
    }

    const fileStat = statSync(absPath);
    if (fileStat.isDirectory()) {
      try {
        const entries = readdirSync(absPath);
        return { output: entries.join('\n'), success: true };
      } catch (error) {
        return { output: `Cannot read directory: ${(error as Error).message}`, success: false, error: 'read_error' };
      }
    }

    if (fileStat.size > 10 * 1024 * 1024) {
      return { output: `File too large: ${fileStat.size} bytes (max 10MB)`, success: false, error: 'file_too_large' };
    }

    try {
      const content = readFileSync(absPath, 'utf-8');

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

const writeTool = (context?: ToolContext): Tool => ({
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

    if (context?.sandbox && !context.sandbox.canWrite(absPath, process.cwd())) {
      return { output: `Write denied by sandbox policy: ${absPath}`, success: false, error: 'sandbox_denied' };
    }

    try {
      const dir = join(absPath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(absPath, content, 'utf-8');
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

const editTool = (context?: ToolContext): Tool => ({
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

    if (!existsSync(absPath)) {
      return { output: `File not found: ${absPath}`, success: false, error: 'file_not_found' };
    }

    if (context?.sandbox && !context.sandbox.canWrite(absPath, process.cwd())) {
      return { output: `Edit denied by sandbox policy: ${absPath}`, success: false, error: 'sandbox_denied' };
    }

    try {
      let content = readFileSync(absPath, 'utf-8');

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
      writeFileSync(absPath, content, 'utf-8');

      return {
        output: `Edited ${absPath} (${oldCount} replacement${oldCount > 1 ? 's' : ''})`,
        success: true,
      };
    } catch (error) {
      return { output: `Edit failed: ${(error as Error).message}`, success: false, error: 'edit_error' };
    }
  },
});

let rgAvailable: boolean | null = null;

function isRgAvailable(): boolean {
  if (rgAvailable !== null) return rgAvailable;
  try {
    const cmd = IS_WIN ? 'where rg' : 'which rg';
    execSync(cmd, { stdio: 'pipe', timeout: 3000 });
    rgAvailable = true;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

function runRipgrep(
  pattern: string,
  searchPath: string,
  globFilter?: string,
  mode: string = 'files',
  maxResults: number = 500,
): string {
  const args: string[] = ['--color', 'never', '--max-count', String(maxResults)];

  if (mode === 'files') {
    args.push('--files-with-matches');
  } else if (mode === 'count') {
    args.push('--count');
  } else {
    args.push('--line-number');
  }

  if (globFilter) {
    args.push('--glob', globFilter);
  }

  args.push('--regexp', pattern, searchPath);

  try {
    const result = execFileSync('rg', args, {
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
      timeout: 30000,
    });
    return result.trim();
  } catch (error: unknown) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    if (e.status === 1 && e.stdout !== undefined) {
      return (e.stdout as string).trim();
    }
    if (e.status === 1) {
      return '';
    }
    if (e.status === 2) {
      throw new Error(
        e.stderr ?? 'ripgrep error',
      );
    }
    throw error;
  }
}

const grepTool: Tool = {
  definition: {
    name: 'grep',
    description: 'Search file contents using regex pattern',
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
        max_results: { type: 'number', description: 'Max results to return', default: 500 },
      },
      required: ['pattern'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const {
      pattern,
      path: searchPath = '.',
      glob: globPattern,
      output_mode = 'files',
      max_results = 500,
    } = args as {
      pattern: string;
      path?: string;
      glob?: string;
      output_mode?: string;
      max_results?: number;
    };

    const absSearchPath = resolve(searchPath);
    if (!existsSync(absSearchPath)) {
      return { output: `Path not found: ${absSearchPath}`, success: false, error: 'path_not_found' };
    }

    try {
      if (isRgAvailable()) {
        const results = runRipgrep(pattern, absSearchPath, globPattern, output_mode, max_results);
        return { output: results || 'No matches found', success: true };
      }

      const regex = new RegExp(pattern, 'i');
      const results = await nativeGrep(absSearchPath, pattern, regex.flags.includes('i'), globPattern, output_mode, max_results);
      return { output: results || 'No matches found', success: true };
    } catch (error) {
      const errMsg = (error as Error).message;
      const isInvalidRegex = errMsg.includes('Invalid regular expression') ||
        errMsg.includes('regex parse error') ||
        errMsg.includes('regex compilation failed');
      if (isInvalidRegex) {
        return {
          output: `Invalid regex pattern: ${pattern}`,
          success: false,
          error: 'invalid_regex',
        };
      }
      return { output: `Grep failed: ${errMsg}`, success: false, error: 'grep_error' };
    }
  },
};

async function nativeGrep(
  searchPath: string,
  patternSource: string,
  caseInsensitive: boolean,
  globFilter?: string,
  mode: string = 'files',
  maxResults: number = 500,
): Promise<string> {
  const statResult = await stat(searchPath);
  if (statResult.isFile()) {
    return grepFile(searchPath, patternSource, caseInsensitive, mode);
  }

  const globPattern = globFilter ? `**/${globFilter}` : '**/*';
  const files: string[] = [];

  for await (const entry of asyncGlob(globPattern, { cwd: searchPath })) {
    files.push(entry);
    if (files.length >= maxResults * 2) break;
  }

  const matchedFiles: string[] = [];
  const contentLines: string[] = [];
  const countMap = new Map<string, number>();
  let totalResults = 0;

  for (const filePath of files) {
    if (totalResults >= maxResults) break;
    const full = join(searchPath, filePath);

    try {
      const fileStat = await stat(full);
      if (fileStat.isDirectory() || fileStat.size > 5 * 1024 * 1024) continue;

      const content = await readFile(full, 'utf-8');
      if (isBinaryContent(content)) continue;

      const lines = content.split('\n');
      let fileCount = 0;
      const fileRegex = new RegExp(patternSource, caseInsensitive ? 'i' : '');

      for (let i = 0; i < lines.length; i++) {
        if (fileRegex.test(lines[i])) {
          fileCount++;
          if (mode === 'content' && totalResults < maxResults) {
            contentLines.push(`${full}:${i + 1}:${lines[i]}`);
            totalResults++;
          }
        }
      }

      if (fileCount > 0) {
        matchedFiles.push(full);
        if (mode === 'count') countMap.set(full, fileCount);
      }
    } catch {
      continue;
    }
  }

  if (mode === 'files') return matchedFiles.join('\n');
  if (mode === 'count') {
    return Array.from(countMap.entries())
      .map(([f, c]) => `${f}:${c}`)
      .join('\n');
  }
  return contentLines.join('\n');
}

async function grepFile(filePath: string, patternSource: string, caseInsensitive: boolean, mode: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const results: string[] = [];
  const fileRegex = new RegExp(patternSource, caseInsensitive ? 'i' : '');

  for (let i = 0; i < lines.length; i++) {
    if (fileRegex.test(lines[i])) {
      if (mode === 'content') results.push(`${filePath}:${i + 1}:${lines[i]}`);
      else if (mode === 'files') return filePath;
      else results.push(`${i + 1}`);
    }
  }

  if (mode === 'files') return '';
  if (mode === 'count') return `${filePath}:${results.length}`;
  return results.join('\n');
}

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

    const absSearchPath = resolve(searchPath);
    if (!existsSync(absSearchPath)) {
      return { output: `Path not found: ${absSearchPath}`, success: false, error: 'path_not_found' };
    }

    try {
      const files: string[] = [];
      for await (const entry of asyncGlob(pattern, { cwd: absSearchPath })) {
        files.push(join(absSearchPath, entry));
        if (files.length >= 250) break;
      }

      return {
        output: files.length > 0 ? files.join('\n') : 'No files found',
        success: true,
        metadata: { count: files.length },
      };
    } catch (error) {
      return { output: `Glob failed: ${(error as Error).message}`, success: false, error: 'glob_error' };
    }
  },
};

const memoryTool = (context?: ToolContext): Tool => ({
  definition: {
    name: 'memory',
    description: 'Manage persistent memory across sessions',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'replace', 'remove', 'list'],
          description: 'Action to perform',
        },
        target: {
          type: 'string',
          enum: ['memory', 'user'],
          description: 'Memory store target',
        },
        content: { type: 'string', description: 'Content to add or replace with' },
        old_text: { type: 'string', description: 'Substring to match for replace/remove' },
      },
      required: ['action', 'target'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { action, target, content, old_text } = args as {
      action: 'add' | 'replace' | 'remove' | 'list';
      target: 'memory' | 'user';
      content?: string;
      old_text?: string;
    };

    if (!context?.memory) {
      return { output: 'Memory system not available', success: false, error: 'no_memory' };
    }

    const mem = context.memory;

    switch (action) {
      case 'add': {
        if (!content) return { output: 'content is required for add', success: false, error: 'missing_content' };
        const result = mem.add(target, content);
        return {
          output: result.success ? `Added to ${target} memory` : `Failed: ${result.error}`,
          success: result.success,
          error: result.error,
        };
      }
      case 'replace': {
        if (!old_text || !content) {
          return { output: 'old_text and content are required for replace', success: false, error: 'missing_params' };
        }
        const result = mem.replace(target, old_text, content);
        return {
          output: result.success ? `Replaced in ${target} memory` : `Failed: ${result.error}`,
          success: result.success,
          error: result.error,
        };
      }
      case 'remove': {
        if (!old_text) return { output: 'old_text is required for remove', success: false, error: 'missing_params' };
        const result = mem.remove(target, old_text);
        return {
          output: result.success ? `Removed from ${target} memory` : `Failed: ${result.error}`,
          success: result.success,
          error: result.error,
        };
      }
      case 'list': {
        const entries = mem.list(target);
        return {
          output: entries.length > 0 ? entries.join('\n') : `${target} memory is empty`,
          success: true,
        };
      }
    }
  },
});

function createAgentTool(context?: ToolContextExtended): Tool {
  return {
    definition: {
      name: 'agent',
      description: 'Spawn a sub-agent with isolated context. Supports explore, plan, and general-purpose modes. Sub-agents cannot spawn further agents (max depth 1).',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Task description for the sub-agent' },
          type: {
            type: 'string',
            enum: ['explore', 'plan', 'general-purpose'],
            description: 'Agent type: explore (research only), plan (architect only), general-purpose (full tools)',
            default: 'general-purpose',
          },
        },
        required: ['prompt'],
      },
    },
    async execute(args, toolContext): Promise<ToolResult> {
      const prompt = args.prompt as string;
      const type = (args.type as string) ?? 'general-purpose';

      const { SubAgentEngine } = await import('../core/sub-agent.js');
      const { ToolRegistry } = await import('./registry.js');

      const subEngine = new SubAgentEngine({
        provider: (toolContext as any)?.provider ?? (context as any)?.provider,
        sessions: (toolContext as any)?.sessions ?? (context as any)?.sessions,
        hooks: (toolContext as any)?.hooks ?? (context as any)?.hooks,
        config: (toolContext as any)?.config ?? (context as any)?.config,
        memory: context?.memory ?? (toolContext as any)?.memory,
        security: (toolContext as any)?.security ?? (context as any)?.security,
        skills: (toolContext as any)?.skills,
      });

      const typeToDef: Record<string, string | undefined> = {
        explore: 'explore',
        plan: 'plan',
      };

      const result = await subEngine.spawn(prompt, new ToolRegistry(), {
        definitionName: typeToDef[type],
      });

      subEngine.destroy();

      return {
        output: result.success
          ? result.output
          : `Sub-agent failed: ${result.error}`,
        success: result.success,
        metadata: {
          tokensUsed: result.tokensUsed,
          toolCalls: result.toolCalls,
        },
      };
    },
  };
}

export interface ToolContextExtended extends ToolContext {
  memory?: import('../memory/system.js').MemorySystem;
  sandbox?: import('../sandbox/manager.js').SandboxManager;
}

export function getBuiltinTools(context?: ToolContextExtended): Tool[] {
  return [
    bashTool(context),
    readTool(context),
    writeTool(context),
    editTool(context),
    grepTool,
    globTool,
    memoryTool(context),
    createAgentTool(context),
  ];
}
