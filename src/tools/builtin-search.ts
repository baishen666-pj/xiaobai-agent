import { execSync, execFileSync } from 'node:child_process';
import { readFile, stat, readdir, glob as asyncGlob, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Tool, ToolResult } from './registry.js';
import { IS_WIN, isBinaryContent, isPathSafe } from './builtin-shell.js';

const exists = (p: string) => access(p).then(() => true, () => false);

export let rgAvailable: boolean | null = null;

/** Reset ripgrep availability cache (for testing) */
export function _resetRgCache(): void { rgAvailable = null; }

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

export const grepTool: Tool = {
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
    if (!(await exists(absSearchPath))) {
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

export const globTool: Tool = {
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
    if (!(await exists(absSearchPath))) {
      return { output: `Path not found: ${absSearchPath}`, success: false, error: 'path_not_found' };
    }

    try {
      const files: string[] = [];
      try {
        for await (const entry of asyncGlob(pattern, { cwd: absSearchPath })) {
          files.push(join(absSearchPath, entry));
          if (files.length >= 250) break;
        }
      } catch {
        // Fallback: recursive readdir when glob is unavailable (Node <22)
        const { readdir: readdirAsync } = await import('node:fs/promises');
        const prefix = pattern.replace(/\*\*\/?/g, '').replace(/\*/g, '');
        const queue = [absSearchPath];
        while (queue.length > 0 && files.length < 250) {
          const dir = queue.shift()!;
          try {
            for (const entry of await readdirAsync(dir, { withFileTypes: true })) {
              const full = join(dir, entry.name);
              if (entry.isDirectory()) { queue.push(full); continue; }
              if (prefix && !entry.name.endsWith(prefix)) continue;
              files.push(full);
            }
          } catch { continue; }
        }
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