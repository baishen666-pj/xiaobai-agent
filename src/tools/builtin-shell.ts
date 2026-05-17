import { spawn, execSync, execFileSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { resolve, normalize, isAbsolute, sep } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './registry.js';

export const MAX_OUTPUT = 50_000;
export const IS_WIN = process.platform === 'win32';

const SAFE_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'TEMP', 'TMP',
  'SHELL', 'TERM', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'COMSPEC',
  'NODE_OPTIONS', 'NODE_PATH',
]);

function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    if (SAFE_ENV_KEYS.has(key.toUpperCase()) || SAFE_ENV_KEYS.has(key)) {
      const val = process.env[key];
      if (val !== undefined) env[key] = val;
    }
  }
  return env;
}

export function truncate(output: string, max = MAX_OUTPUT): string {
  if (output.length <= max) return output;
  const half = Math.floor(max / 2) - 20;
  return output.slice(0, half) + `\n\n... [truncated ${output.length - max} chars] ...\n\n` + output.slice(-half);
}

export const SENSITIVE_PATHS_WIN = [
  normalize(`${process.env.SYSTEMROOT ?? 'C:\\Windows'}\\System32`),
  normalize(`${process.env.SYSTEMROOT ?? 'C:\\Windows'}\\SysWOW64`),
  normalize(`${process.env.SYSTEMROOT ?? 'C:\\Windows'}\\config`),
];
export const SENSITIVE_PATHS_UNIX = ['/etc/passwd', '/etc/shadow', '/etc/ssh', '/root/.ssh', '/boot', '/proc', '/sys/kernel'];

export function isPathSafe(filePath: string, allowedDirs?: string[]): boolean {
  const normalized = normalize(resolve(filePath));
  if (!isAbsolute(normalized)) return false;

  // Block sensitive system paths
  const sensitive = IS_WIN ? SENSITIVE_PATHS_WIN : SENSITIVE_PATHS_UNIX;
  if (sensitive.some((p) => normalized.toLowerCase().startsWith(p.toLowerCase()))) return false;

  if (allowedDirs?.length) {
    return allowedDirs.some((dir) => normalized.startsWith(normalize(resolve(dir)) + sep) || normalized === normalize(resolve(dir)));
  }
  return true;
}

export function isBinaryContent(content: string): boolean {
  const sample = content.slice(0, 8192);
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0) nullCount++;
    if (nullCount > 1) return true;
  }
  return false;
}

export interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  code?: number;
  timedOut?: boolean;
}

export function execStreaming(command: string, cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const shell = IS_WIN ? 'cmd.exe' : '/bin/bash';
    const shellArgs = IS_WIN ? ['/c', command] : ['-c', command];

    const child: ChildProcess = spawn(shell, shellArgs, {
      cwd,
      env: buildSafeEnv(),
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

export const bashTool = (context?: ToolContext): Tool => ({
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