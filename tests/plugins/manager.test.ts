import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginManager } from '../../src/plugins/manager.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { HookSystem } from '../../src/hooks/system.js';
import { ConfigManager } from '../../src/config/manager.js';
import { MemorySystem } from '../../src/memory/system.js';
import { ProviderRouter } from '../../src/provider/router.js';

let tempDir: string;
let pluginsDir: string;
let manager: PluginManager;

function createTestPlugin(name: string, withInit = true, withActivate = true) {
  const dir = join(pluginsDir, name);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name,
    version: '1.0.0',
    description: `${name} test plugin`,
    author: 'test',
    permissions: ['tools:register'],
  }));

  const initFn = withInit ? `async init(api) { api.logger.info('init ${name}'); },` : '';
  const activateFn = withActivate ? `async activate() {},` : '';
  const deactivateFn = `async deactivate() {},`;

  writeFileSync(join(dir, 'index.js'), `
export default {
  manifest: ${JSON.stringify({ name, version: '1.0.0', description: `${name} test`, permissions: ['tools:register'] })},
  ${initFn}
  ${activateFn}
  ${deactivateFn}
};
`);
}

beforeEach(() => {
  tempDir = join(tmpdir(), `xiaobai-test-manager-${Date.now()}`);
  pluginsDir = join(tempDir, 'plugins');
  mkdirSync(pluginsDir, { recursive: true });

  const tools = new ToolRegistry();
  const hooks = new HookSystem(tempDir);
  const config = new ConfigManager();
  const memory = new MemorySystem(tempDir);
  const provider = new ProviderRouter(config.get());

  manager = new PluginManager({
    tools,
    hooks,
    config,
    memory,
    providers: provider,
    pluginsDir,
  });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PluginManager', () => {
  it('init discovers no plugins when directory is empty', async () => {
    await manager.init();
    expect(manager.list()).toHaveLength(0);
  });

  it('init discovers and initializes plugins', async () => {
    createTestPlugin('plugin-a');
    createTestPlugin('plugin-b');

    await manager.init();
    const list = manager.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name).sort()).toEqual(['plugin-a', 'plugin-b']);
  });

  it('activateAll transitions plugins to activated', async () => {
    createTestPlugin('plugin-a');
    await manager.init();
    await manager.activateAll();

    const list = manager.list();
    expect(list.every((p) => p.state === 'activated')).toBe(true);
  });

  it('deactivateAll transitions plugins to deactivated', async () => {
    createTestPlugin('plugin-a');
    await manager.init();
    await manager.activateAll();
    await manager.deactivateAll();

    const list = manager.list();
    expect(list.every((p) => p.state === 'deactivated')).toBe(true);
  });

  it('activate single plugin by name', async () => {
    createTestPlugin('plugin-a');
    createTestPlugin('plugin-b');
    await manager.init();

    await manager.activate('plugin-a');

    const list = manager.list();
    const a = list.find((p) => p.name === 'plugin-a');
    const b = list.find((p) => p.name === 'plugin-b');
    expect(a?.state).toBe('activated');
    expect(b?.state).toBe('initialized');
  });

  it('deactivate single plugin by name', async () => {
    createTestPlugin('plugin-a');
    await manager.init();
    await manager.activateAll();

    await manager.deactivate('plugin-a');

    const a = manager.list().find((p) => p.name === 'plugin-a');
    expect(a?.state).toBe('deactivated');
  });

  it('records errors when plugin fails to init', async () => {
    const dir = join(pluginsDir, 'bad-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
      name: 'bad-plugin',
      version: '1.0.0',
      description: 'Bad',
      permissions: [],
    }));
    writeFileSync(join(dir, 'index.js'), `
export default {
  manifest: { name: 'bad-plugin', version: '1.0.0', description: 'Bad', permissions: [] },
  async init() { throw new Error('init failed'); },
};
`);

    await manager.init();
    const errors = manager.getErrors();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].pluginName).toBe('bad-plugin');
    expect(errors[0].phase).toBe('init');
  });

  it('records errors when plugin fails to activate', async () => {
    const dir = join(pluginsDir, 'crash-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
      name: 'crash-plugin',
      version: '1.0.0',
      description: 'Crash',
      permissions: [],
    }));
    writeFileSync(join(dir, 'index.js'), `
export default {
  manifest: { name: 'crash-plugin', version: '1.0.0', description: 'Crash', permissions: [] },
  async activate() { throw new Error('activate crashed'); },
};
`);

    await manager.init();
    await manager.activateAll();
    const errors = manager.getErrors();
    expect(errors.some((e) => e.phase === 'activate')).toBe(true);
  });

  it('install copies a plugin directory', async () => {
    const sourceDir = join(tempDir, 'source', 'new-plugin');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'plugin.json'), JSON.stringify({
      name: 'new-plugin',
      version: '1.0.0',
      description: 'New',
      permissions: [],
    }));
    writeFileSync(join(sourceDir, 'index.js'), 'export default { manifest: {} };');

    await manager.install(sourceDir);

    expect(manager.list()).toHaveLength(0); // not yet discovered since we didn't re-init
  });

  it('install throws for non-existent source', async () => {
    await expect(manager.install('/nonexistent/path')).rejects.toThrow('does not exist');
  });

  it('install throws when plugin already exists', async () => {
    const sourceDir = join(tempDir, 'existing');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'plugin.json'), '{}');

    mkdirSync(join(pluginsDir, 'existing'), { recursive: true });
    await expect(manager.install(sourceDir)).rejects.toThrow('already exists');
  });

  it('uninstall removes a plugin', async () => {
    createTestPlugin('to-remove');
    await manager.init();
    await manager.activateAll();

    await manager.uninstall('to-remove');
    expect(manager.list()).toHaveLength(0);
  });

  it('get returns a plugin handle', async () => {
    createTestPlugin('plugin-a');
    await manager.init();

    const handle = manager.get('plugin-a');
    expect(handle).toBeDefined();
    expect(handle?.plugin.manifest.name).toBe('plugin-a');
  });

  it('get returns undefined for unknown plugin', () => {
    expect(manager.get('nonexistent')).toBeUndefined();
  });

  it('plugin info includes all fields', async () => {
    createTestPlugin('plugin-a');
    await manager.init();

    const info = manager.list()[0];
    expect(info.name).toBe('plugin-a');
    expect(info.version).toBe('1.0.0');
    expect(info.description).toContain('test plugin');
    expect(info.author).toBe('test');
    expect(info.state).toBe('initialized');
  });
});
