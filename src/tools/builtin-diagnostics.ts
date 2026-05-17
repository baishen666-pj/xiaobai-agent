import { execFile } from 'node:child_process';
import { isPathSafe, truncate } from './builtin-shell.js';
import type { Tool, ToolContext, ToolResult } from './registry.js';

const MAX_DIAGNOSTICS = 200;

interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

interface DiagnosticsSummary {
  totalErrors: number;
  totalWarnings: number;
  diagnostics: Diagnostic[];
}

function parseTscOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n').filter((line) => line.trim().length > 0);

  const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    diagnostics.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      severity: match[4] as 'error' | 'warning',
      code: match[5],
      message: match[6],
    });
    if (diagnostics.length >= MAX_DIAGNOSTICS) break;
  }

  return diagnostics;
}

function parseEslintOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  let results: Array<{
    filePath: string;
    messages: Array<{
      line: number;
      column: number;
      severity: number;
      ruleId: string | null;
      message: string;
    }>;
  }>;

  try {
    results = JSON.parse(output);
  } catch {
    return diagnostics;
  }

  if (!Array.isArray(results)) return diagnostics;

  for (const fileResult of results) {
    if (!fileResult.messages || !Array.isArray(fileResult.messages)) continue;
    for (const msg of fileResult.messages) {
      diagnostics.push({
        file: fileResult.filePath,
        line: msg.line ?? 0,
        column: msg.column ?? 0,
        severity: msg.severity === 1 ? 'warning' : 'error',
        code: msg.ruleId ?? 'unknown',
        message: msg.message,
      });
      if (diagnostics.length >= MAX_DIAGNOSTICS) return diagnostics;
    }
  }

  return diagnostics;
}

function runCommand(
  cmd: string,
  args: string[],
  timeout: number = 60000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          reject(error);
          return;
        }
      }
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      });
    });
  });
}

async function runTypecheck(path?: string, config?: string): Promise<DiagnosticsSummary> {
  const args: string[] = ['tsc', '--noEmit', '--pretty', 'false'];
  if (config) args.push('-p', config);
  if (path) args.push(path);

  try {
    const { stdout } = await runCommand('npx', args);
    const diagnostics = parseTscOutput(stdout);
    const totalErrors = diagnostics.filter((d) => d.severity === 'error').length;
    const totalWarnings = diagnostics.filter((d) => d.severity === 'warning').length;
    return { totalErrors, totalWarnings, diagnostics };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT') || message.includes('not found') || message.includes('spawn')) {
      return {
        totalErrors: 1,
        totalWarnings: 0,
        diagnostics: [{
          file: '',
          line: 0,
          column: 0,
          severity: 'error',
          code: 'TOOL_NOT_FOUND',
          message: 'TypeScript compiler (tsc) not found. Install it with: npm install -D typescript',
        }],
      };
    }
    return {
      totalErrors: 1,
      totalWarnings: 0,
      diagnostics: [{
        file: '',
        line: 0,
        column: 0,
        severity: 'error',
        code: 'TSC_ERROR',
        message: truncate(message),
      }],
    };
  }
}

async function runLint(path?: string, config?: string): Promise<DiagnosticsSummary> {
  const args: string[] = ['eslint', '--format', 'json'];
  if (config) args.push('-c', config);
  args.push(path ?? '.');

  try {
    const { stdout, exitCode } = await runCommand('npx', args);
    // eslint exits with code 1 when there are lint errors, but stdout is still valid JSON
    if (!stdout.trim()) {
      return { totalErrors: 0, totalWarnings: 0, diagnostics: [] };
    }
    const diagnostics = parseEslintOutput(stdout);
    const totalErrors = diagnostics.filter((d) => d.severity === 'error').length;
    const totalWarnings = diagnostics.filter((d) => d.severity === 'warning').length;
    return { totalErrors, totalWarnings, diagnostics };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT') || message.includes('not found') || message.includes('spawn')) {
      return {
        totalErrors: 1,
        totalWarnings: 0,
        diagnostics: [{
          file: '',
          line: 0,
          column: 0,
          severity: 'error',
          code: 'TOOL_NOT_FOUND',
          message: 'ESLint not found. Install it with: npm install -D eslint',
        }],
      };
    }
    return {
      totalErrors: 1,
      totalWarnings: 0,
      diagnostics: [{
        file: '',
        line: 0,
        column: 0,
        severity: 'error',
        code: 'ESLINT_ERROR',
        message: truncate(message),
      }],
    };
  }
}

export const diagnosticsTool: Tool = {
  definition: {
    name: 'diagnostics',
    description: 'Run TypeScript type-checking and/or ESLint linting diagnostics',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['typecheck', 'lint', 'check'],
          description: 'Action to perform: typecheck (tsc), lint (eslint), or check (both)',
        },
        path: {
          type: 'string',
          description: 'File or directory to check',
        },
        config: {
          type: 'string',
          description: 'Path to tsconfig or eslint config',
        },
      },
      required: ['action'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { action, path: targetPath, config } = args as {
      action: 'typecheck' | 'lint' | 'check';
      path?: string;
      config?: string;
    };

    if (targetPath && !isPathSafe(targetPath)) {
      return {
        output: `Path not allowed: ${targetPath}`,
        success: false,
        error: 'path_unsafe',
      };
    }

    if (config && !isPathSafe(config)) {
      return {
        output: `Config path not allowed: ${config}`,
        success: false,
        error: 'path_unsafe',
      };
    }

    if (action === 'typecheck') {
      const summary = await runTypecheck(targetPath, config);
      const hasErrors = summary.totalErrors > 0;
      return {
        output: JSON.stringify(summary, null, 2),
        success: !hasErrors,
        metadata: {
          totalErrors: summary.totalErrors,
          totalWarnings: summary.totalWarnings,
          count: summary.diagnostics.length,
        },
      };
    }

    if (action === 'lint') {
      const summary = await runLint(targetPath, config);
      const hasErrors = summary.totalErrors > 0;
      return {
        output: JSON.stringify(summary, null, 2),
        success: !hasErrors,
        metadata: {
          totalErrors: summary.totalErrors,
          totalWarnings: summary.totalWarnings,
          count: summary.diagnostics.length,
        },
      };
    }

    if (action === 'check') {
      const [tscResult, eslintResult] = await Promise.all([
        runTypecheck(targetPath, config),
        runLint(targetPath, config),
      ]);

      const combined: DiagnosticsSummary = {
        totalErrors: tscResult.totalErrors + eslintResult.totalErrors,
        totalWarnings: tscResult.totalWarnings + eslintResult.totalWarnings,
        diagnostics: [...tscResult.diagnostics, ...eslintResult.diagnostics].slice(0, MAX_DIAGNOSTICS),
      };

      const hasErrors = combined.totalErrors > 0;
      return {
        output: JSON.stringify(combined, null, 2),
        success: !hasErrors,
        metadata: {
          totalErrors: combined.totalErrors,
          totalWarnings: combined.totalWarnings,
          count: combined.diagnostics.length,
        },
      };
    }

    return {
      output: `Unknown action: ${action}`,
      success: false,
      error: 'invalid_action',
    };
  },
};
