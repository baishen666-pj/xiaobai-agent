import { execFile } from 'node:child_process';
import { isPathSafe } from './builtin-shell.js';
import type { Tool, ToolContext, ToolResult } from './registry.js';

const MAX_OUTPUT = 50_000;

function truncate(output: string, max = MAX_OUTPUT): string {
  if (output.length <= max) return output;
  const half = Math.floor(max / 2) - 20;
  return output.slice(0, half) + `\n\n... [truncated ${output.length - max} chars] ...\n\n` + output.slice(-half);
}

type GitAction = 'status' | 'diff' | 'log' | 'blame' | 'branch' | 'stash_list' | 'remote';

const VALID_ACTIONS = new Set<string>([
  'status', 'diff', 'log', 'blame', 'branch', 'stash_list', 'remote',
]);

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
      timeout: 30000,
    }, (error, stdout, stderr) => {
      if (error) {
        const err = error as NodeJS.ErrnoException & { code?: string };
        if (err.code === 'ENOENT') {
          reject(new Error('git_not_installed'));
          return;
        }
        if (stderr?.includes('not a git repository')) {
          reject(new Error('not_a_git_repo'));
          return;
        }
        if (stderr?.includes('fatal:')) {
          reject(new Error(stderr.trim()));
          return;
        }
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

interface StatusResult {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
}

function parseStatus(raw: string): StatusResult {
  const result: StatusResult = {
    branch: '',
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      result.branch = line.slice('# branch.head '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const parts = line.slice('# branch.ab '.length).trim().split(' ');
      for (const part of parts) {
        if (part.startsWith('+')) result.ahead = parseInt(part.slice(1), 10) || 0;
        else if (part.startsWith('-')) result.behind = parseInt(part.slice(1), 10) || 0;
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4);
      if (xy[0] !== '.' && xy[0] !== '?') result.staged++;
      if (xy[1] !== '.' && xy[1] !== '?') result.unstaged++;
    } else if (line.startsWith('? ')) {
      result.untracked++;
    }
  }

  return result;
}

function formatStatus(parsed: StatusResult): string {
  const lines: string[] = [
    `Branch: ${parsed.branch || 'unknown'}`,
    `Ahead: ${parsed.ahead}, Behind: ${parsed.behind}`,
    `Staged: ${parsed.staged}, Unstaged: ${parsed.unstaged}, Untracked: ${parsed.untracked}`,
  ];
  return lines.join('\n');
}

interface LogEntry {
  hash: string;
  message: string;
}

function parseLog(raw: string): LogEntry[] {
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) return { hash: line, message: '' };
      return {
        hash: line.slice(0, spaceIdx),
        message: line.slice(spaceIdx + 1),
      };
    });
}

function formatLog(entries: LogEntry[]): string {
  return entries.map((e) => `${e.hash} ${e.message}`).join('\n');
}

interface BlameLine {
  line: number;
  hash: string;
  author: string;
  content: string;
}

function parseBlame(raw: string): BlameLine[] {
  const lines: BlameLine[] = [];
  let currentHash = '';
  let currentAuthor = '';
  let currentLine = 0;
  let pendingContent = false;

  for (const line of raw.split('\n')) {
    if (line.startsWith('\t')) {
      if (pendingContent) {
        lines.push({
          line: currentLine,
          hash: currentHash,
          author: currentAuthor,
          content: line.slice(1),
        });
        pendingContent = false;
      }
    } else if (line.startsWith('author ')) {
      currentAuthor = line.slice('author '.length);
    } else if (line.includes(' ') && !line.startsWith('author') && !line.startsWith('summary') && !line.startsWith('filename')) {
      const firstSpace = line.indexOf(' ');
      const header = line.slice(0, firstSpace);
      const rest = line.slice(firstSpace + 1);

      if (header.length >= 40) {
        currentHash = header;
      }

      const lineMatch = rest.match(/^(\d+) /);
      if (lineMatch) {
        currentLine = parseInt(lineMatch[1], 10);
        pendingContent = true;
      }
    }
  }

  return lines;
}

function formatBlame(lines: BlameLine[]): string {
  return lines
    .map((l) => `${l.line}\t${l.hash.slice(0, 8)}\t${l.author}\t${l.content}`)
    .join('\n');
}

export const gitTool: Tool = {
  definition: {
    name: 'git',
    description: 'Read-only Git repository operations (status, diff, log, blame, branch, stash list, remote)',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'diff', 'log', 'blame', 'branch', 'stash_list', 'remote'],
          description: 'Git operation to perform (read-only)',
        },
        path: {
          type: 'string',
          description: 'File or directory path',
        },
        max_count: {
          type: 'number',
          description: 'Max log entries (default 20)',
        },
        branch: {
          type: 'string',
          description: 'Branch name for operations',
        },
      },
      required: ['action'],
    },
  },

  async execute(args): Promise<ToolResult> {
    const {
      action,
      path: filePath,
      max_count: maxCount = 20,
      branch: branchName,
    } = args as {
      action: string;
      path?: string;
      max_count?: number;
      branch?: string;
    };

    if (!VALID_ACTIONS.has(action)) {
      return {
        output: `Invalid git action: ${action}. Only read-only actions are allowed.`,
        success: false,
        error: 'invalid_action',
      };
    }

    const cwd = filePath ?? process.cwd();

    if (filePath && !isPathSafe(filePath)) {
      return {
        output: `Path is not safe or is outside allowed directories: ${filePath}`,
        success: false,
        error: 'path_unsafe',
      };
    }

    try {
      switch (action as GitAction) {
        case 'status': {
          const raw = await runGit(['status', '--porcelain=v2', '--branch'], cwd);
          const parsed = parseStatus(raw);
          return {
            output: formatStatus(parsed),
            success: true,
            metadata: { branch: parsed.branch, ahead: parsed.ahead, behind: parsed.behind, staged: parsed.staged, unstaged: parsed.unstaged, untracked: parsed.untracked },
          };
        }

        case 'diff': {
          const diffArgs = ['diff', '--stat'];
          if (filePath) {
            diffArgs.push('--', filePath);
          }
          const raw = await runGit(diffArgs, cwd);
          return {
            output: truncate(raw.trim() || 'No changes'),
            success: true,
          };
        }

        case 'log': {
          const logArgs = ['log', '--oneline', `--max-count=${maxCount}`];
          if (branchName) {
            logArgs.push(branchName);
          }
          const raw = await runGit(logArgs, cwd);
          const entries = parseLog(raw);
          return {
            output: formatLog(entries) || 'No commits',
            success: true,
            metadata: { count: entries.length },
          };
        }

        case 'blame': {
          if (!filePath) {
            return {
              output: 'blame action requires a file path',
              success: false,
              error: 'missing_path',
            };
          }
          const blameArgs = ['blame', '--porcelain'];
          if (branchName) {
            blameArgs.push(branchName);
          }
          blameArgs.push('--', filePath);
          const raw = await runGit(blameArgs, cwd);
          const lines = parseBlame(raw);
          return {
            output: truncate(formatBlame(lines)),
            success: true,
            metadata: { lines: lines.length },
          };
        }

        case 'branch': {
          const raw = await runGit(['branch', '-a', '-v'], cwd);
          return {
            output: truncate(raw.trim() || 'No branches'),
            success: true,
          };
        }

        case 'stash_list': {
          const raw = await runGit(['stash', 'list'], cwd);
          return {
            output: raw.trim() || 'No stash entries',
            success: true,
          };
        }

        case 'remote': {
          const raw = await runGit(['remote', '-v'], cwd);
          return {
            output: raw.trim() || 'No remotes configured',
            success: true,
          };
        }
      }
    } catch (error) {
      const msg = (error as Error).message;

      if (msg === 'git_not_installed') {
        return {
          output: 'Git is not installed or not found in PATH',
          success: false,
          error: 'git_not_installed',
        };
      }

      if (msg === 'not_a_git_repo') {
        return {
          output: 'Not a git repository',
          success: false,
          error: 'not_a_git_repo',
        };
      }

      return {
        output: truncate(`Git ${action} failed: ${msg}`),
        success: false,
        error: 'git_error',
      };
    }

    return { output: 'Unknown state', success: false, error: 'unknown' };
  },
};
