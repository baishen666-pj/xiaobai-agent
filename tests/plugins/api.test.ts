import { describe, it, expect, beforeEach } from 'vitest';
import { PluginAPIImpl } from '../../src/plugins/api.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { HookSystem } from '../../src/hooks/system.js';
import { ConfigManager } from '../../src/config/manager.js';
import { MemorySystem } from '../../src/memory/system.js';
import { ProviderRouter } from '../../src/provider/router.js';
import type { PluginError } from '../../src/plugins/types.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
let errors: PluginError[];
let api: PluginAPIImpl;
let tools: ToolRegistry;
let hooks: HookSystem;
let config: ConfigManager;
let memory: MemorySystem;
let provider: ProviderRouter;

beforeEach(() => {
  tempDir = join(tmpdir(), `xiaobai-test-api-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  errors = [];
  tools = new ToolRegistry();
  hooks = new HookSystem(tempDir);
  config = new ConfigManager();
  memory = new MemorySystem(tempDir);
  provider = new ProviderRouter(config.get());

  api = new PluginAPIImpl(
    'test-plugin',
    { name: 'test-plugin', version: '1.0.0', description: 'Test', permissions: [] },
    tools,
    hooks,
    config,
    memory,
    provider,
    (err) => errors.push(err),
  );
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PluginAPIImpl', () => {
  it('starts with discovered state', () => {
    expect(api.state).toBe('discovered');
    expect(api.pluginName).toBe('test-plugin');
  });

  it('tracks state changes', () => {
    api.setState('initialized');
    expect(api.state).toBe('initialized');
  });

  describe('tools', () => {
    it('registers a tool with plugin prefix', () => {
      api.tools.register({
        definition: { name: 'my-tool', description: 'Test tool', parameters: { type: 'object', properties: {} } },
        execute: async () => ({ output: 'done', success: true }),
      });

      expect(tools.has('test-plugin:my-tool')).toBe(true);
      expect(tools.has('my-tool')).toBe(false);
    });

    it('unregisters a prefixed tool', () => {
      api.tools.register({
        definition: { name: 'my-tool', description: 'Test', parameters: { type: 'object', properties: {} } },
        execute: async () => ({ output: '', success: true }),
      });

      expect(tools.has('test-plugin:my-tool')).toBe(true);
      api.tools.unregister('my-tool');
      expect(tools.has('test-plugin:my-tool')).toBe(false);
    });

    it('records error on register failure', () => {
      const badTool = null as any;
      api.tools.register(badTool);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('hooks', () => {
    it('subscribes to hook events', async () => {
      let called = false;
      api.hooks.on('pre_turn', async () => { called = true; });

      await hooks.emit('pre_turn');
      expect(called).toBe(true);
    });

    it('returns unsubscribe function', async () => {
      let count = 0;
      const unsub = api.hooks.on('post_turn', async () => { count++; });

      await hooks.emit('post_turn');
      expect(count).toBe(1);

      unsub();
      await hooks.emit('post_turn');
      expect(count).toBe(1);
    });

    it('cleanup fns are tracked', () => {
      api.hooks.on('pre_turn', async () => {});
      expect(api.getCleanupFns().length).toBe(1);
    });
  });

  describe('config', () => {
    it('returns empty object when no plugin config', () => {
      const result = api.config.get();
      expect(result).toBeDefined();
    });

    it('sets and gets scoped config', () => {
      api.config.set({ key: 'value' });
      const result = api.config.get();
      expect(result).toEqual({ key: 'value' });
    });
  });

  describe('memory', () => {
    it('adds content to memory', () => {
      api.memory.add('test memory content');
      const items = api.memory.list();
      expect(items).toContain('test memory content');
    });

    it('lists memory entries', () => {
      api.memory.add('item 1');
      api.memory.add('item 2');
      const items = api.memory.list();
      expect(items).toContain('item 1');
      expect(items).toContain('item 2');
    });
  });

  describe('logger', () => {
    it('does not throw on any log level', () => {
      expect(() => api.logger.info('test')).not.toThrow();
      expect(() => api.logger.warn('test')).not.toThrow();
      expect(() => api.logger.error('test')).not.toThrow();
    });
  });
});
