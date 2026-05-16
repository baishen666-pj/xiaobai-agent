import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock node:child_process so that exec returns controlled error objects
// with .status set (Windows cmd.exe uses .code instead of .status, so
// without mocking, lines 139-145 in system.ts are unreachable on Windows).
const mockExec = vi.fn();
vi.mock('node:child_process', () => ({
  exec: mockExec,
}));

// Must import AFTER vi.mock so the module picks up the mock
const { HookSystem, BLOCK, WARN, ALLOW } = await import('../../src/hooks/system.js');

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-hooks-exec-'));
  mockExec.mockReset();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('HookSystem - executeCommandHook error status branches (mocked exec)', () => {
  it('returns block when command exits with status 2 and has stderr', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, callback: any) => {
      const error = new Error('Command failed') as any;
      error.status = 2;
      error.stderr = 'Operation not permitted';
      callback(error, '', '');
      return { stdin: { end: vi.fn() } };
    });

    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'test-cmd',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('block');
    expect(result.message).toBe('Operation not permitted');
  });

  it('returns block with fallback message when status 2 and stderr is undefined', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, callback: any) => {
      const error = new Error('Command failed') as any;
      error.status = 2;
      // stderr is undefined so the ?? fallback kicks in
      callback(error, '', '');
      return { stdin: { end: vi.fn() } };
    });

    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'test-cmd',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('block');
    expect(result.message).toBe('Blocked by hook');
  });

  it('returns warn when command exits with status 1 and has stderr', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, callback: any) => {
      const error = new Error('Command failed') as any;
      error.status = 1;
      error.stderr = 'Non-zero exit detected';
      callback(error, '', '');
      return { stdin: { end: vi.fn() } };
    });

    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'test-cmd',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('warn');
    expect(result.message).toBe('Non-zero exit detected');
  });

  it('returns warn with fallback message when status 1 and stderr is undefined', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, callback: any) => {
      const error = new Error('Command failed') as any;
      error.status = 1;
      // stderr is undefined so the ?? fallback kicks in
      callback(error, '', '');
      return { stdin: { end: vi.fn() } };
    });

    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'test-cmd',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('warn');
    expect(result.message).toBe('Hook warning');
  });

  it('returns allow with error message for other exit statuses', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, callback: any) => {
      const error = new Error('spawn ENOENT') as any;
      error.status = 127;
      callback(error, '', '');
      return { stdin: { end: vi.fn() } };
    });

    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'nonexistent',
    });
    // emit returns worst=ALLOW for non-block handler results, but the handler
    // result has exitCode='allow' with an error message.
    // However emit tracks 'worst' and only updates on warn/block. For allow
    // it returns the initial worst=ALLOW constant (no message).
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('allow');
  });

  it('returns allow with error message for error with no status', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, callback: any) => {
      const error = new Error('Timeout reached') as any;
      // No .status property at all
      callback(error, '', '');
      return { stdin: { end: vi.fn() } };
    });

    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'slow-cmd',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('allow');
  });

  it('successful command with no __BLOCK__ or __WARN__ returns allow with stdout', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, callback: any) => {
      callback(null, 'all good\n', '');
      return { stdin: { end: vi.fn() } };
    });

    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'ok-cmd',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('allow');
  });
});
