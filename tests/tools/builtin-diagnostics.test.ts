import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { diagnosticsTool } from '../../src/tools/builtin-diagnostics.js';

// Hoisted mock for node:child_process execFile
let mockExecFileOverride: ((...args: any[]) => any) | null = null;

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return {
    ...orig,
    execFile: (...args: any[]) => {
      if (mockExecFileOverride) return mockExecFileOverride(...args);
      return orig.execFile(...args);
    },
  };
});

beforeEach(() => {
  mockExecFileOverride = null;
});

afterEach(() => {
  mockExecFileOverride = null;
});

function makeExecFileCallback(
  stdout: string,
  stderr: string = '',
  exitCode: number = 0,
): (...args: any[]) => any {
  return (_cmd: string, _args: string[], _opts: any, callback: any) => {
    if (typeof _opts === 'function') {
      callback = _opts;
    }
    const err = exitCode !== 0 ? Object.assign(new Error(`Exit code ${exitCode}`), { code: exitCode }) : null;
    callback(err, stdout, stderr);
  };
}

describe('diagnosticsTool', () => {
  it('has correct definition', () => {
    expect(diagnosticsTool.definition.name).toBe('diagnostics');
    expect(diagnosticsTool.definition.parameters.required).toContain('action');
    const actionProp = diagnosticsTool.definition.parameters.properties.action as { enum: string[] };
    expect(actionProp.enum).toContain('typecheck');
    expect(actionProp.enum).toContain('lint');
    expect(actionProp.enum).toContain('check');
  });

  describe('typecheck action', () => {
    it('parses tsc output correctly', async () => {
      const tscOutput = [
        'src/index.ts(10,5): error TS2322: Type \'string\' is not assignable to type \'number\'.',
        'src/utils.ts(20,1): warning TS6133: \'unused\' is declared but its value is never read.',
        'src/main.ts(30,10): error TS2345: Argument of type \'number\' is not assignable to parameter of type \'string\'.',
      ].join('\n');

      mockExecFileOverride = makeExecFileCallback(tscOutput, '', 1);

      const result = await diagnosticsTool.execute({ action: 'typecheck' });

      expect(result.success).toBe(false);
      expect(result.metadata?.totalErrors).toBe(2);
      expect(result.metadata?.totalWarnings).toBe(1);
      expect(result.metadata?.count).toBe(3);

      const parsed = JSON.parse(result.output);
      expect(parsed.diagnostics).toHaveLength(3);
      expect(parsed.diagnostics[0]).toEqual({
        file: 'src/index.ts',
        line: 10,
        column: 5,
        severity: 'error',
        code: 'TS2322',
        message: 'Type \'string\' is not assignable to type \'number\'.',
      });
      expect(parsed.diagnostics[1]).toEqual({
        file: 'src/utils.ts',
        line: 20,
        column: 1,
        severity: 'warning',
        code: 'TS6133',
        message: '\'unused\' is declared but its value is never read.',
      });
    });

    it('returns success when no errors', async () => {
      mockExecFileOverride = makeExecFileCallback('', '', 0);

      const result = await diagnosticsTool.execute({ action: 'typecheck' });

      expect(result.success).toBe(true);
      expect(result.metadata?.totalErrors).toBe(0);
      expect(result.metadata?.totalWarnings).toBe(0);
      expect(result.metadata?.count).toBe(0);
    });

    it('passes config via -p flag', async () => {
      let capturedArgs: string[] = [];
      mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: any) => {
        capturedArgs = args;
        callback(null, '', '');
      };

      await diagnosticsTool.execute({ action: 'typecheck', config: 'tsconfig.strict.json' });

      expect(capturedArgs).toContain('-p');
      expect(capturedArgs).toContain('tsconfig.strict.json');
    });

    it('passes path to tsc', async () => {
      let capturedArgs: string[] = [];
      mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: any) => {
        capturedArgs = args;
        callback(null, '', '');
      };

      await diagnosticsTool.execute({ action: 'typecheck', path: 'src/index.ts' });

      expect(capturedArgs).toContain('src/index.ts');
    });

    it('handles tsc not found', async () => {
      mockExecFileOverride = (_cmd: string, _args: string[], _opts: any, callback: any) => {
        const err = new Error('spawn npx ENOENT') as Error & { code: string };
        err.code = 'ENOENT';
        callback(err, '', '');
      };

      const result = await diagnosticsTool.execute({ action: 'typecheck' });

      expect(result.success).toBe(false);
      const parsed = JSON.parse(result.output);
      expect(parsed.diagnostics[0].code).toBe('TOOL_NOT_FOUND');
      expect(parsed.diagnostics[0].message).toContain('TypeScript');
    });

    it('truncates to 200 diagnostics', async () => {
      const lines = Array.from({ length: 300 }, (_, i) =>
        `src/file${i}.ts(${i + 1},1): error TS2322: error message ${i}`,
      ).join('\n');

      mockExecFileOverride = makeExecFileCallback(lines, '', 1);

      const result = await diagnosticsTool.execute({ action: 'typecheck' });

      const parsed = JSON.parse(result.output);
      expect(parsed.diagnostics.length).toBe(200);
    });
  });

  describe('lint action', () => {
    it('parses eslint JSON output correctly', async () => {
      const eslintOutput = JSON.stringify([
        {
          filePath: '/project/src/index.ts',
          messages: [
            { line: 5, column: 10, severity: 2, ruleId: 'no-unused-vars', message: "'x' is defined but never used." },
            { line: 12, column: 1, severity: 1, ruleId: 'prefer-const', message: 'Use const instead of let.' },
          ],
        },
        {
          filePath: '/project/src/utils.ts',
          messages: [
            { line: 8, column: 3, severity: 2, ruleId: '@typescript-eslint/no-explicit-any', message: 'Unexpected any.' },
          ],
        },
      ]);

      mockExecFileOverride = makeExecFileCallback(eslintOutput, '', 1);

      const result = await diagnosticsTool.execute({ action: 'lint' });

      expect(result.success).toBe(false);
      expect(result.metadata?.totalErrors).toBe(2);
      expect(result.metadata?.totalWarnings).toBe(1);
      expect(result.metadata?.count).toBe(3);

      const parsed = JSON.parse(result.output);
      expect(parsed.diagnostics).toHaveLength(3);
      expect(parsed.diagnostics[0]).toEqual({
        file: '/project/src/index.ts',
        line: 5,
        column: 10,
        severity: 'error',
        code: 'no-unused-vars',
        message: "'x' is defined but never used.",
      });
      expect(parsed.diagnostics[1]).toEqual({
        file: '/project/src/index.ts',
        line: 12,
        column: 1,
        severity: 'warning',
        code: 'prefer-const',
        message: 'Use const instead of let.',
      });
      expect(parsed.diagnostics[2]).toEqual({
        file: '/project/src/utils.ts',
        line: 8,
        column: 3,
        severity: 'error',
        code: '@typescript-eslint/no-explicit-any',
        message: 'Unexpected any.',
      });
    });

    it('returns success when no issues found', async () => {
      const eslintOutput = JSON.stringify([
        { filePath: '/project/src/clean.ts', messages: [] },
      ]);

      mockExecFileOverride = makeExecFileCallback(eslintOutput, '', 0);

      const result = await diagnosticsTool.execute({ action: 'lint' });

      expect(result.success).toBe(true);
      expect(result.metadata?.totalErrors).toBe(0);
      expect(result.metadata?.totalWarnings).toBe(0);
    });

    it('handles empty stdout gracefully', async () => {
      mockExecFileOverride = makeExecFileCallback('', '', 0);

      const result = await diagnosticsTool.execute({ action: 'lint' });

      expect(result.success).toBe(true);
      expect(result.metadata?.count).toBe(0);
    });

    it('handles invalid JSON from eslint', async () => {
      mockExecFileOverride = makeExecFileCallback('not valid json', '', 1);

      const result = await diagnosticsTool.execute({ action: 'lint' });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.diagnostics).toHaveLength(0);
    });

    it('passes config via -c flag', async () => {
      let capturedArgs: string[] = [];
      mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: any) => {
        capturedArgs = args;
        callback(null, '[]', '');
      };

      await diagnosticsTool.execute({ action: 'lint', config: '.eslintrc.custom.json' });

      expect(capturedArgs).toContain('-c');
      expect(capturedArgs).toContain('.eslintrc.custom.json');
    });

    it('passes path to eslint', async () => {
      let capturedArgs: string[] = [];
      mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: any) => {
        capturedArgs = args;
        callback(null, '[]', '');
      };

      await diagnosticsTool.execute({ action: 'lint', path: 'src/' });

      expect(capturedArgs).toContain('src/');
    });

    it('handles eslint not found', async () => {
      mockExecFileOverride = (_cmd: string, _args: string[], _opts: any, callback: any) => {
        const err = new Error('spawn npx ENOENT') as Error & { code: string };
        err.code = 'ENOENT';
        callback(err, '', '');
      };

      const result = await diagnosticsTool.execute({ action: 'lint' });

      expect(result.success).toBe(false);
      const parsed = JSON.parse(result.output);
      expect(parsed.diagnostics[0].code).toBe('TOOL_NOT_FOUND');
      expect(parsed.diagnostics[0].message).toContain('ESLint');
    });

    it('handles null ruleId in eslint messages', async () => {
      const eslintOutput = JSON.stringify([
        {
          filePath: '/project/src/index.ts',
          messages: [
            { line: 1, column: 1, severity: 2, ruleId: null, message: 'Parsing error' },
          ],
        },
      ]);

      mockExecFileOverride = makeExecFileCallback(eslintOutput, '', 1);

      const result = await diagnosticsTool.execute({ action: 'lint' });
      const parsed = JSON.parse(result.output);

      expect(parsed.diagnostics[0].code).toBe('unknown');
    });

    it('truncates to 200 diagnostics', async () => {
      const messages = Array.from({ length: 300 }, (_, i) => ({
        line: i + 1,
        column: 1,
        severity: 2,
        ruleId: 'no-unused-vars',
        message: `error ${i}`,
      }));
      const eslintOutput = JSON.stringify([
        { filePath: '/project/src/big.ts', messages },
      ]);

      mockExecFileOverride = makeExecFileCallback(eslintOutput, '', 1);

      const result = await diagnosticsTool.execute({ action: 'lint' });
      const parsed = JSON.parse(result.output);

      expect(parsed.diagnostics.length).toBe(200);
    });
  });

  describe('check action', () => {
    it('runs both typecheck and lint in parallel', async () => {
      let callCount = 0;
      mockExecFileOverride = (cmd: string, args: string[], _opts: any, callback: any) => {
        callCount++;
        if (args[0] === 'tsc') {
          callback(null, 'src/a.ts(1,1): error TS2322: type error\n', '');
        } else {
          const output = JSON.stringify([
            { filePath: '/src/a.ts', messages: [{ line: 2, column: 1, severity: 1, ruleId: 'no-console', message: 'no console' }] },
          ]);
          const err = Object.assign(new Error('exit 1'), { code: 1 });
          callback(err, output, '');
        }
      };

      const result = await diagnosticsTool.execute({ action: 'check' });

      expect(result.success).toBe(false);
      expect(result.metadata?.totalErrors).toBe(1);
      expect(result.metadata?.totalWarnings).toBe(1);
      expect(result.metadata?.count).toBe(2);
      expect(callCount).toBe(2);
    });

    it('returns success when both pass clean', async () => {
      mockExecFileOverride = (_cmd: string, args: string[], _opts: any, callback: any) => {
        if (args[0] === 'tsc') {
          callback(null, '', '');
        } else {
          callback(null, '[]', '');
        }
      };

      const result = await diagnosticsTool.execute({ action: 'check' });

      expect(result.success).toBe(true);
      expect(result.metadata?.totalErrors).toBe(0);
      expect(result.metadata?.totalWarnings).toBe(0);
    });
  });

  describe('path validation', () => {
    it('rejects unsafe paths', async () => {
      const result = await diagnosticsTool.execute({
        action: 'typecheck',
        path: 'C:\\Windows\\System32\\evil.ts',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('path_unsafe');
    });

    it('rejects unsafe config paths', async () => {
      const result = await diagnosticsTool.execute({
        action: 'lint',
        config: 'C:\\Windows\\System32\\evil.json',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('path_unsafe');
    });
  });
});
