import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HookSystem, ALLOW, WARN, BLOCK } from '../../src/hooks/system.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-hooks-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('HookSystem', () => {
  it('creates hooks directory on construction', () => {
    new HookSystem(tempDir);
    expect(existsSync(join(tempDir, 'hooks'))).toBe(true);
  });

  it('loads hooks from hooks.json', () => {
    const hooksDir = join(tempDir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(join(hooksDir, 'hooks.json'), JSON.stringify({
      pre_tool_use: [{ event: 'pre_tool_use', type: 'command', command: 'echo ok' }],
    }), 'utf-8');
    const hs = new HookSystem(tempDir);
  });

  it('handles corrupted hooks.json gracefully', () => {
    const hooksDir = join(tempDir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(join(hooksDir, 'hooks.json'), 'bad json{{{', 'utf-8');
    expect(() => new HookSystem(tempDir)).not.toThrow();
  });

  it('on() registers a listener and returns unsubscribe function', async () => {
    const hs = new HookSystem(tempDir);
    const listener = vi.fn().mockReturnValue(undefined);
    const unsub = hs.on('session_start', listener);

    await hs.emit('session_start', {});
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    await hs.emit('session_start', {});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('emit returns ALLOW when no listeners', async () => {
    const hs = new HookSystem(tempDir);
    const result = await hs.emit('nonexistent_event', {});
    expect(result.exitCode).toBe('allow');
  });

  it('emit returns block when listener blocks', async () => {
    const hs = new HookSystem(tempDir);
    hs.on('user_prompt_submit', () => BLOCK('Dangerous prompt'));
    const result = await hs.emit('user_prompt_submit', { message: 'test' });
    expect(result.exitCode).toBe('block');
    expect(result.message).toBe('Dangerous prompt');
  });

  it('emit returns warn when listener warns', async () => {
    const hs = new HookSystem(tempDir);
    hs.on('pre_tool_use', () => WARN('Be careful'));
    const result = await hs.emit('pre_tool_use', { tool: 'bash' });
    expect(result.exitCode).toBe('warn');
    expect(result.message).toBe('Be careful');
  });

  it('emit returns allow when listener allows', async () => {
    const hs = new HookSystem(tempDir);
    hs.on('post_tool_use', () => ALLOW);
    const result = await hs.emit('post_tool_use', {});
    expect(result.exitCode).toBe('allow');
  });

  it('emit handles async listeners', async () => {
    const hs = new HookSystem(tempDir);
    hs.on('session_start', async () => {
      await new Promise((r) => setTimeout(r, 10));
      return BLOCK('Async block');
    });
    const result = await hs.emit('session_start', {});
    expect(result.exitCode).toBe('block');
  });

  it('emit processes listeners before handlers', async () => {
    const hs = new HookSystem(tempDir);
    const order: string[] = [];
    hs.on('test_event', () => { order.push('listener'); return undefined as any; });
    hs.registerHandler('test_event', { event: 'test_event', type: 'command', command: 'echo ok' });
    // Listeners run first
    await hs.emit('test_event', {});
    expect(order[0]).toBe('listener');
  });

  it('multiple listeners are called in order', async () => {
    const hs = new HookSystem(tempDir);
    const order: number[] = [];
    hs.on('test_event', () => { order.push(1); return undefined as any; });
    hs.on('test_event', () => { order.push(2); return undefined as any; });
    hs.on('test_event', () => { order.push(3); return undefined as any; });
    await hs.emit('test_event', {});
    expect(order).toEqual([1, 2, 3]);
  });

  it('block short-circuits remaining listeners', async () => {
    const hs = new HookSystem(tempDir);
    let secondCalled = false;
    hs.on('test_event', () => BLOCK('stop'));
    hs.on('test_event', () => { secondCalled = true; return undefined as any; });
    await hs.emit('test_event', {});
    expect(secondCalled).toBe(false);
  });

  it('warn upgrades to block', async () => {
    const hs = new HookSystem(tempDir);
    hs.on('test_event', () => WARN('warning'));
    hs.on('test_event', () => BLOCK('blocked'));
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('block');
  });

  it('registerHandler adds a handler', () => {
    const hs = new HookSystem(tempDir);
    hs.registerHandler('custom_event', { event: 'custom_event', type: 'command', command: 'echo test' });
  });

  it('saveHooks persists handlers to disk', () => {
    const hs = new HookSystem(tempDir);
    hs.registerHandler('pre_tool_use', { event: 'pre_tool_use', type: 'command', command: 'check-tool.sh' });
    hs.saveHooks();
    const saved = JSON.parse(readFileSync(join(tempDir, 'hooks', 'hooks.json'), 'utf-8'));
    expect(saved.pre_tool_use).toHaveLength(1);
    expect(saved.pre_tool_use[0].command).toBe('check-tool.sh');
  });

  it('ALLOW constant has allow exit code', () => {
    expect(ALLOW.exitCode).toBe('allow');
  });

  it('WARN creates warn result with message', () => {
    const result = WARN('test warning');
    expect(result.exitCode).toBe('warn');
    expect(result.message).toBe('test warning');
  });

  it('BLOCK creates block result with message', () => {
    const result = BLOCK('test block');
    expect(result.exitCode).toBe('block');
    expect(result.message).toBe('test block');
  });

  it('listener returning void is treated as allow', async () => {
    const hs = new HookSystem(tempDir);
    hs.on('test_event', () => { /* no return */ });
    const result = await hs.emit('test_event', {});
    expect(result.exitCode).toBe('allow');
  });
});
