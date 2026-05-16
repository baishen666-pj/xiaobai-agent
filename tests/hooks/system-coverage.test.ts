import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HookSystem, ALLOW, WARN, BLOCK } from '../../src/hooks/system.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-hooks-cov-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// executeCommandHook - success paths (real shell execution)
// ---------------------------------------------------------------------------
describe('HookSystem - executeCommandHook success paths', () => {
  it('command hook detects __BLOCK__ in output and returns block', async () => {
    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'echo __BLOCK__ Access denied',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('block');
    expect(result.message).toBe('Access denied');
  });

  it('command hook detects __WARN__ in output and returns warn', async () => {
    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'echo __WARN__ Deprecated usage',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('warn');
    expect(result.message).toBe('Deprecated usage');
  });

  it('command hook returns allow for successful command', async () => {
    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'echo hello world',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// executeHttpHook - all branches via fetch mock
// ---------------------------------------------------------------------------
describe('HookSystem - executeHttpHook coverage', () => {
  it('http hook handles response with explicit exitCode=block', async () => {
    const hs = new HookSystem(tempDir);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ exitCode: 'block', reason: 'Not allowed' }),
    });

    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'http',
      url: 'http://localhost:1234/hook',
    });
    const result = await hs.emit('test_event', { action: 'test' });
    expect(result.exitCode).toBe('block');
    expect(result.message).toBe('Not allowed');

    globalThis.fetch = originalFetch;
  });

  it('http hook derives block from blocked=true (no exitCode)', async () => {
    const hs = new HookSystem(tempDir);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ blocked: true, message: 'Blocked by policy' }),
    });

    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'http',
      url: 'http://localhost:1234/hook',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('block');
    expect(result.message).toBe('Blocked by policy');

    globalThis.fetch = originalFetch;
  });

  it('http hook defaults to allow when no exitCode or blocked in response', async () => {
    const hs = new HookSystem(tempDir);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ message: 'All good' }),
    });

    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'http',
      url: 'http://localhost:1234/hook',
    });
    const result = await hs.emit('test_event', {});
    // For allow results, emit returns worst=ALLOW (no message property)
    expect(result.exitCode).toBe('allow');

    globalThis.fetch = originalFetch;
  });

  it('http hook returns allow on network error', async () => {
    const hs = new HookSystem(tempDir);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'http',
      url: 'http://localhost:1234/hook',
    });
    // The catch returns allow; emit returns worst=ALLOW
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('allow');

    globalThis.fetch = originalFetch;
  });

  it('http hook sends POST with JSON body and correct headers', async () => {
    const hs = new HookSystem(tempDir);
    const originalFetch = globalThis.fetch;
    const fetchCalls: Array<{ url: string; options: RequestInit }> = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, options: RequestInit) => {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        json: () => Promise.resolve({ exitCode: 'allow' }),
      });
    });

    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'http',
      url: 'http://localhost:9999/webhook',
    });
    await hs.emit('test_event', { key: 'value', nested: { a: 1 } });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe('http://localhost:9999/webhook');
    expect(fetchCalls[0].options.method).toBe('POST');
    expect(fetchCalls[0].options.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(fetchCalls[0].options.body as string);
    expect(body).toEqual({ key: 'value', nested: { a: 1 } });

    globalThis.fetch = originalFetch;
  });

  it('http hook uses reason field over message field', async () => {
    const hs = new HookSystem(tempDir);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        exitCode: 'warn',
        reason: 'Primary reason',
        message: 'Secondary message',
      }),
    });

    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'http',
      url: 'http://localhost:1234/hook',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('warn');
    expect(result.message).toBe('Primary reason');

    globalThis.fetch = originalFetch;
  });

  it('http hook uses message field when reason is absent', async () => {
    const hs = new HookSystem(tempDir);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        exitCode: 'block',
        message: 'Fallback message',
      }),
    });

    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'http',
      url: 'http://localhost:1234/hook',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('block');
    expect(result.message).toBe('Fallback message');

    globalThis.fetch = originalFetch;
  });
});

// ---------------------------------------------------------------------------
// executeHandler - default branch (unknown type)
// ---------------------------------------------------------------------------
describe('HookSystem - executeHandler default branch', () => {
  it('handler with prompt type returns null, treated as allow', async () => {
    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'prompt' as any,
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// emit - default data parameter
// ---------------------------------------------------------------------------
describe('HookSystem - emit default data', () => {
  it('emit uses empty object as default data', async () => {
    const hs = new HookSystem(tempDir);
    const result = await hs.emit('test_event');
    expect(result.exitCode).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// emit - listener returning non-HookResult
// ---------------------------------------------------------------------------
describe('HookSystem - listener returning non-HookResult', () => {
  it('listener returning a plain string is treated as allow', async () => {
    const hs = new HookSystem(tempDir);
    hs.on('test_event', () => 'just a string' as any);
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// emit - warn as worst from handler
// ---------------------------------------------------------------------------
describe('HookSystem - warn stays as worst when no block follows', () => {
  it('warn from command handler is returned as worst result', async () => {
    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'echo __WARN__ Check this',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('warn');
    expect(result.message).toBe('Check this');
  });
});

// ---------------------------------------------------------------------------
// emit - block short-circuits remaining handlers
// ---------------------------------------------------------------------------
describe('HookSystem - block short-circuits handlers', () => {
  it('block from handler stops processing subsequent handlers', async () => {
    const hs = new HookSystem(tempDir);
    hs.on('test_event', () => ALLOW);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'echo __BLOCK__ handler blocked',
    });
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'echo second-handler-ran',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('block');
  });
});

// ---------------------------------------------------------------------------
// loadHooks edge cases
// ---------------------------------------------------------------------------
describe('HookSystem - loadHooks edge cases', () => {
  it('loadHooks handles corrupted hooks.json gracefully', () => {
    const hooksDir = join(tempDir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(join(hooksDir, 'hooks.json'), 'bad json{{{', 'utf-8');
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => new HookSystem(tempDir)).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// registerHandler accumulates
// ---------------------------------------------------------------------------
describe('HookSystem - registerHandler accumulation', () => {
  it('registerHandler adds multiple handlers to the same event', () => {
    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', { event: 'test_event', type: 'command', command: 'echo one' });
    hs.registerHandler('test_event', { event: 'test_event', type: 'command', command: 'echo two' });
    hs.saveHooks();

    const saved = JSON.parse(readFileSync(join(tempDir, 'hooks', 'hooks.json'), 'utf-8'));
    expect(saved.test_event).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// on() - unsubscribe safety
// ---------------------------------------------------------------------------
describe('HookSystem - unsubscribe safety', () => {
  it('calling unsubscribe twice does not throw', async () => {
    const hs = new HookSystem(tempDir);
    const unsub = hs.on('test_event', () => ALLOW);

    unsub();
    expect(() => unsub()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// emit with handler returning null (prompt type) followed by real handler
// ---------------------------------------------------------------------------
describe('HookSystem - null handler skipped', () => {
  it('emit skips null results from prompt-type handlers', async () => {
    const hs = new HookSystem(tempDir);
    hs.registerHandler('test_event', { event: 'test_event', type: 'prompt' } as any);
    hs.registerHandler('test_event', {
      event: 'test_event',
      type: 'command',
      command: 'echo __WARN__ from second handler',
    });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('warn');
    expect(result.message).toBe('from second handler');
  });
});
