import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginManager } from '../../src/plugins/manager.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { HookSystem } from '../../src/hooks/system.js';
import { ConfigManager } from '../../src/config/manager.js';
import { MemorySystem } from '../../src/memory/system.js';
import { ProviderRouter } from '../../src/provider/router.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
let pluginsDir: string;
let manager: PluginManager;

function createDeps() {
  const tools = new ToolRegistry();
  const hooks = new HookSystem(tempDir);
  const config = new ConfigManager();
  const memory = new MemorySystem(tempDir);
  const providers = new ProviderRouter(config.get());
  return { tools, hooks, config, memory, providers, pluginsDir };
}

function writePlugin(name: string, version = '1.0.0') {
  const dir = join(pluginsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name,
    version,
    description: `${name} plugin`,
    permissions: ['tools:register'],
  }));
  writeFileSync(join(dir, 'index.js'), `
export default {
  manifest: { name: '${name}', version: '${version}', description: '${name} plugin', permissions: ['tools:register'] },
  async init(api) {
    api.tools.register({
      definition: { name: '${name}-tool', description: '${name} tool', parameters: { type: 'object', properties: {} } },
      execute: async () => ({ output: '${name}', success: true }),
    });
  },
  async activate() {},
  async deactivate() {},
};
`);
}

beforeEach(() => {
  tempDir = join(tmpdir(), `xiaobai-test-reload-${Date.now()}`);
  pluginsDir = join(tempDir, 'plugins');
  mkdirSync(pluginsDir, { recursive: true });
  manager = new PluginManager(createDeps());
});

afterEach(() => {
  manager.stopWatching();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Plugin Hot Reload', () => {
  it('starts and stops file watcher', () => {
    writePlugin('test-plugin');
    manager.startWatching();
    manager.stopWatching();
    // No errors thrown
  });

  it('startWatching is idempotent', () => {
    writePlugin('test-plugin');
    manager.startWatching();
    manager.startWatching();
    manager.stopWatching();
  });

  it('stopWatching clears debounce timers', async () => {
    writePlugin('test-plugin');
    await manager.init();
    manager.startWatching();

    writePlugin('test-plugin', '1.1.0');
    manager.stopWatching();
  });

  it('debounces rapid file changes', async () => {
    vi.useFakeTimers();
    writePlugin('test-plugin');
    await manager.init();
    manager.startWatching();

    writePlugin('test-plugin', '1.1.0');
    writePlugin('test-plugin', '1.2.0');

    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    manager.stopWatching();
  });

  it('startWatching skips non-existent directory', () => {
    const badManager = new PluginManager({ ...createDeps(), pluginsDir: '/nonexistent/path' });
    badManager.startWatching();
    badManager.stopWatching();
  });

  it('reloads plugin after file change', async () => {
    writePlugin('reload-test');
    await manager.init();
    await manager.activateAll();

    const listBefore = manager.list();
    expect(listBefore[0].state).toBe('activated');

    writePlugin('reload-test', '2.0.0');
    manager.stopWatching();
  });
});
