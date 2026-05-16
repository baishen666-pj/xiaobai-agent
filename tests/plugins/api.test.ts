import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    { name: 'test-plugin', version: '1.0.0', description: 'Test', permissions: ['tools:register', 'hooks:subscribe', 'config:read', 'config:write', 'memory:read', 'memory:write', 'providers:register'] },
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
      expect(result.key).toBe('value');
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

  describe('permission enforcement', () => {
    function makeRestrictedApi(permissions: string[]) {
      return new PluginAPIImpl(
        'restricted-plugin',
        { name: 'restricted-plugin', version: '1.0.0', description: 'Restricted', permissions },
        tools,
        hooks,
        config,
        memory,
        provider,
        (err) => errors.push(err),
      );
    }

    it('tools.register reports error when tools:register permission missing', () => {
      const restricted = makeRestrictedApi([]);
      restricted.tools.register({
        definition: { name: 't', description: 'T', parameters: { type: 'object', properties: {} } },
        execute: async () => ({ output: '', success: true }),
      });
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('tools.register');
      expect(errors[0].error.message).toContain('tools:register');
    });

    it('tools.unregister reports error when tools:register permission missing', () => {
      const restricted = makeRestrictedApi([]);
      restricted.tools.unregister('anything');
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('tools.unregister');
    });

    it('hooks.on throws when hooks:subscribe permission missing', () => {
      const restricted = makeRestrictedApi([]);
      expect(() => restricted.hooks.on('pre_turn', async () => {})).toThrow(/hooks:subscribe/);
    });

    it('providers.register reports error when providers:register permission missing', () => {
      const restricted = makeRestrictedApi([]);
      restricted.providers.register('x', () => null as any);
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('providers.register');
    });

    it('providers.unregister reports error when providers:register permission missing', () => {
      const restricted = makeRestrictedApi([]);
      restricted.providers.unregister('x');
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('providers.unregister');
    });

    it('config.get returns empty object when config:read permission missing', () => {
      const restricted = makeRestrictedApi([]);
      const result = restricted.config.get();
      expect(result).toEqual({});
    });

    it('config.set reports error when config:write permission missing', () => {
      const restricted = makeRestrictedApi([]);
      restricted.config.set({ a: 1 });
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('config.set');
    });

    it('memory.add reports error when memory:write permission missing', () => {
      const restricted = makeRestrictedApi([]);
      restricted.memory.add('data');
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('memory.add');
    });

    it('memory.list returns empty array when memory:read permission missing', () => {
      const restricted = makeRestrictedApi([]);
      const result = restricted.memory.list();
      expect(result).toEqual([]);
    });
  });

  describe('providers', () => {
    it('registers a provider factory', () => {
      const factory = () => null as any;
      api.providers.register('custom-provider', factory);
      // No error means success
      expect(errors.length).toBe(0);
    });

    it('unregisters a provider factory', () => {
      const factory = () => null as any;
      api.providers.register('custom-provider', factory);
      api.providers.unregister('custom-provider');
      expect(errors.length).toBe(0);
    });

    it('registers provider reports error on failure', () => {
      // Force an error by making registerProviderFactory throw
      const origRegister = provider.registerProviderFactory;
      provider.registerProviderFactory = () => { throw new Error('boom'); };
      api.providers.register('bad-provider', () => null as any);
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('providers.register');
      expect(errors[0].error.message).toBe('boom');
      provider.registerProviderFactory = origRegister;
    });

    it('registers provider wraps non-Error throws', () => {
      const origRegister = provider.registerProviderFactory;
      provider.registerProviderFactory = () => { throw 'string-error'; };
      api.providers.register('bad-provider', () => null as any);
      expect(errors.length).toBe(1);
      expect(errors[0].error.message).toBe('string-error');
      provider.registerProviderFactory = origRegister;
    });

    it('unregisters provider reports error on failure', () => {
      const origUnregister = provider.unregisterProviderFactory;
      provider.unregisterProviderFactory = () => { throw new Error('unregister-fail'); };
      api.providers.unregister('nonexistent');
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('providers.unregister');
      expect(errors[0].error.message).toBe('unregister-fail');
      provider.unregisterProviderFactory = origUnregister;
    });
  });

  describe('tools.unregister edge cases', () => {
    it('does nothing when tool name not found in mapping', () => {
      // Register then manually clear the internal mapping to test the no-op path
      api.tools.register({
        definition: { name: 'my-tool', description: 'Test', parameters: { type: 'object', properties: {} } },
        execute: async () => ({ output: '', success: true }),
      });
      // Unregister first to remove from mapping
      api.tools.unregister('my-tool');
      // Unregister again - name no longer in mapping, no error
      api.tools.unregister('my-tool');
      expect(errors.length).toBe(0);
    });

    it('unregister reports error wrapping non-Error throw', () => {
      // Create an API without tools:register but intercept checkPermission
      // Instead, make unregister throw a non-Error
      const origUnregister = tools.unregister;
      tools.unregister = () => { throw 42; };
      api.tools.register({
        definition: { name: 't', description: 'T', parameters: { type: 'object', properties: {} } },
        execute: async () => ({ output: '', success: true }),
      });
      api.tools.unregister('t');
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('tools.unregister');
      expect(errors[0].error.message).toBe('42');
      tools.unregister = origUnregister;
    });
  });

  describe('config edge cases', () => {
    // Use unique plugin name to avoid config state leaking between tests
    const uniqueName = `config-test-${Date.now()}`;
    let configApi: PluginAPIImpl;
    let configErrors: PluginError[];

    beforeEach(() => {
      configErrors = [];
      configApi = new PluginAPIImpl(
        uniqueName,
        { name: uniqueName, version: '1.0.0', description: 'Config test', permissions: ['config:read', 'config:write'] },
        tools,
        hooks,
        config,
        memory,
        provider,
        (err) => configErrors.push(err),
      );
    });

    it('config.get returns plugin config when it exists', () => {
      configApi.config.set({ myKey: 'myVal' });
      const result = configApi.config.get();
      expect(result.myKey).toBe('myVal');
    });

    it('config.get merges existing config with new values', () => {
      configApi.config.set({ a: 1 });
      configApi.config.set({ b: 2 });
      const result = configApi.config.get();
      expect(result.a).toBe(1);
      expect(result.b).toBe(2);
    });

    it('config.set reports error wrapping non-Error throw', () => {
      const origSave = config.save;
      config.save = () => { throw 'config-write-failed'; };
      configApi.config.set({ x: 1 });
      expect(configErrors.length).toBe(1);
      expect(configErrors[0].phase).toBe('config.set');
      expect(configErrors[0].error.message).toBe('config-write-failed');
      config.save = origSave;
    });

    it('config.get returns empty on unexpected error', () => {
      const origGet = config.get;
      config.get = () => { throw new Error('read-fail'); };
      const result = configApi.config.get();
      expect(result).toEqual({});
      config.get = origGet;
    });
  });

  describe('memory edge cases', () => {
    it('memory.add reports error wrapping non-Error throw', () => {
      const origAdd = memory.add;
      memory.add = () => { throw 'memory-write-err'; };
      api.memory.add('content');
      expect(errors.length).toBe(1);
      expect(errors[0].phase).toBe('memory.add');
      expect(errors[0].error.message).toBe('memory-write-err');
      memory.add = origAdd;
    });

    it('memory.list returns empty array on error', () => {
      const origList = memory.list;
      memory.list = () => { throw new Error('list-fail'); };
      const result = api.memory.list();
      expect(result).toEqual([]);
      memory.list = origList;
    });
  });

  describe('logger output', () => {
    it('logs info with plugin name prefix', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      api.logger.info('hello world');
      expect(spy).toHaveBeenCalledWith('[plugin:test-plugin] hello world');
      spy.mockRestore();
    });

    it('logs warn with WARN prefix', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      api.logger.warn('caution');
      expect(spy).toHaveBeenCalledWith('[plugin:test-plugin] WARN: caution');
      spy.mockRestore();
    });

    it('logs error with ERROR prefix', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      api.logger.error('failure');
      expect(spy).toHaveBeenCalledWith('[plugin:test-plugin] ERROR: failure');
      spy.mockRestore();
    });
  });

  describe('checkPermission error message', () => {
    it('includes declared permissions in error', () => {
      const restricted = new PluginAPIImpl(
        'myplug',
        { name: 'myplug', version: '1.0.0', description: '', permissions: ['config:read'] },
        tools,
        hooks,
        config,
        memory,
        provider,
        (err) => errors.push(err),
      );
      restricted.memory.add('x');
      expect(errors.length).toBe(1);
      expect(errors[0].error.message).toContain('memory:write');
      expect(errors[0].error.message).toContain('config:read');
    });
  });
});
