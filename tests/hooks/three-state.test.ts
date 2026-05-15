import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HookSystem, ALLOW, WARN, BLOCK, type HookEvent } from '../../src/hooks/system.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Three-State Hook System', () => {
  let hookDir: string;
  let hooks: HookSystem;

  beforeEach(() => {
    hookDir = mkdtempSync(join(tmpdir(), 'xiaobai-hooks-'));
    hooks = new HookSystem(hookDir);
  });

  afterEach(() => {
    rmSync(hookDir, { recursive: true, force: true });
  });

  it('returns ALLOW by default', async () => {
    const result = await hooks.emit('pre_tool_use', { tool: 'read' });
    expect(result.exitCode).toBe('allow');
  });

  it('listener can return ALLOW', async () => {
    hooks.on('pre_tool_use', () => ALLOW);
    const result = await hooks.emit('pre_tool_use', { tool: 'read' });
    expect(result.exitCode).toBe('allow');
  });

  it('listener can return WARN', async () => {
    hooks.on('pre_tool_use', () => WARN('deprecated tool'));
    const result = await hooks.emit('pre_tool_use', { tool: 'old_tool' });
    expect(result.exitCode).toBe('warn');
    expect(result.message).toBe('deprecated tool');
  });

  it('listener can return BLOCK', async () => {
    hooks.on('pre_tool_use', () => BLOCK('security violation'));
    const result = await hooks.emit('pre_tool_use', { tool: 'bash' });
    expect(result.exitCode).toBe('block');
    expect(result.message).toBe('security violation');
  });

  it('stops processing on BLOCK', async () => {
    const order: string[] = [];
    hooks.on('pre_tool_use', () => { order.push('first'); return BLOCK('stop'); });
    hooks.on('pre_tool_use', () => { order.push('second'); return ALLOW; });

    const result = await hooks.emit('pre_tool_use', {});
    expect(result.exitCode).toBe('block');
    expect(order).toEqual(['first']);
  });

  it('continues processing on WARN but tracks warnings', async () => {
    const order: string[] = [];
    hooks.on('pre_tool_use', () => { order.push('warn'); return WARN('watch out'); });
    hooks.on('pre_tool_use', () => { order.push('allow'); return ALLOW; });

    const data: Record<string, unknown> = {};
    const result = await hooks.emit('pre_tool_use', data);
    expect(order).toEqual(['warn', 'allow']);
  });

  it('supports all lifecycle events', () => {
    const events: HookEvent[] = [
      'session_start', 'session_end', 'pre_turn', 'post_turn',
      'pre_tool_use', 'post_tool_use', 'user_prompt_submit',
      'stop', 'pre_compact', 'post_compact', 'config_change',
      'permission_request',
    ];

    for (const event of events) {
      hooks.on(event, () => ALLOW);
    }
  });

  it('unsubscribes via returned function', async () => {
    let count = 0;
    const unsub = hooks.on('pre_turn', () => { count++; return ALLOW; });

    await hooks.emit('pre_turn');
    expect(count).toBe(1);

    unsub();
    await hooks.emit('pre_turn');
    expect(count).toBe(1);
  });

  it('loads hooks from config file', async () => {
    writeFileSync(join(hookDir, 'hooks.json'), JSON.stringify({
      pre_tool_use: [{ event: 'pre_tool_use', type: 'http', url: 'http://localhost:9999/hook' }],
    }));

    const loaded = new HookSystem(hookDir);
    const result = await loaded.emit('pre_tool_use', { tool: 'test' });
    expect(result.exitCode).toBe('allow');
  });

  it('saves hooks to config file', () => {
    hooks.registerHandler('post_tool_use', {
      event: 'post_tool_use',
      type: 'http',
      url: 'http://localhost:8888/check',
    });
    hooks.saveHooks();

    const loaded = new HookSystem(hookDir);
    const handlers = (loaded as any).handlers.get('post_tool_use');
    expect(handlers).toHaveLength(1);
    expect(handlers[0].url).toBe('http://localhost:8888/check');
  });
});
