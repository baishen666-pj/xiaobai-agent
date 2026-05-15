import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverPlugins, validateManifest, loadPluginModule } from '../../src/plugins/loader.js';

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `xiaobai-test-plugins-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('validateManifest', () => {
  it('validates a correct manifest', () => {
    const manifest = validateManifest({
      name: 'my-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      permissions: ['tools:register'],
    });
    expect(manifest.name).toBe('my-plugin');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.permissions).toEqual(['tools:register']);
  });

  it('rejects missing name', () => {
    expect(() => validateManifest({ version: '1.0.0', description: 'test', permissions: [] }))
      .toThrow();
  });

  it('rejects invalid name format', () => {
    expect(() => validateManifest({ name: 'My_Plugin', version: '1.0.0', description: 'test', permissions: [] }))
      .toThrow();
  });

  it('rejects invalid version', () => {
    expect(() => validateManifest({ name: 'test', version: 'abc', description: 'test', permissions: [] }))
      .toThrow();
  });

  it('rejects invalid permissions', () => {
    expect(() => validateManifest({ name: 'test', version: '1.0.0', description: 'test', permissions: ['invalid'] }))
      .toThrow();
  });

  it('defaults permissions to empty array', () => {
    const manifest = validateManifest({ name: 'test', version: '1.0.0', description: 'test' });
    expect(manifest.permissions).toEqual([]);
  });
});

describe('discoverPlugins', () => {
  it('returns empty array for non-existent directory', () => {
    const results = discoverPlugins(join(tempDir, 'nonexistent'));
    expect(results).toEqual([]);
  });

  it('returns empty array for empty directory', () => {
    const results = discoverPlugins(tempDir);
    expect(results).toEqual([]);
  });

  it('discovers valid plugins', () => {
    const pluginDir = join(tempDir, 'my-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'my-plugin',
      version: '1.0.0',
      description: 'Test',
      permissions: [],
    }));

    const results = discoverPlugins(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].manifest.name).toBe('my-plugin');
    expect(results[0].state).toBe('discovered');
  });

  it('skips directories without plugin.json', () => {
    const pluginDir = join(tempDir, 'no-manifest');
    mkdirSync(pluginDir, { recursive: true });

    const results = discoverPlugins(tempDir);
    expect(results).toHaveLength(0);
  });

  it('skips directories with invalid plugin.json', () => {
    const pluginDir = join(tempDir, 'bad-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), 'not json');

    const results = discoverPlugins(tempDir);
    expect(results).toHaveLength(0);
  });

  it('skips dot-prefixed directories', () => {
    const pluginDir = join(tempDir, '.hidden');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'hidden',
      version: '1.0.0',
      description: 'Hidden',
      permissions: [],
    }));

    const results = discoverPlugins(tempDir);
    expect(results).toHaveLength(0);
  });

  it('discovers multiple plugins', () => {
    for (const name of ['plugin-a', 'plugin-b', 'plugin-c']) {
      const dir = join(tempDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
        name,
        version: '1.0.0',
        description: `${name} desc`,
        permissions: [],
      }));
    }

    const results = discoverPlugins(tempDir);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.manifest.name).sort()).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
  });
});

describe('loadPluginModule', () => {
  it('throws when no index.js exists', async () => {
    const pluginDir = join(tempDir, 'no-index');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'no-index',
      version: '1.0.0',
      description: 'Test',
      permissions: [],
    }));

    const discovered = { dir: pluginDir, manifest: { name: 'no-index', version: '1.0.0', description: 'Test', permissions: [] }, state: 'discovered' as const };
    await expect(loadPluginModule(discovered)).rejects.toThrow('no index.js found');
  });

  it('loads a valid plugin module', async () => {
    const pluginDir = join(tempDir, 'valid-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'valid-plugin',
      version: '1.0.0',
      description: 'Valid',
      permissions: [],
    }));
    writeFileSync(join(pluginDir, 'index.js'), `
export default {
  manifest: ${JSON.stringify({ name: 'valid-plugin', version: '1.0.0', description: 'Valid', permissions: [] })},
  async init(api) { api.logger.info('init'); },
  async activate() {},
  async deactivate() {},
};
`);

    const discovered = { dir: pluginDir, manifest: { name: 'valid-plugin', version: '1.0.0', description: 'Valid', permissions: [] }, state: 'discovered' as const };
    const plugin = await loadPluginModule(discovered);
    expect(plugin.manifest.name).toBe('valid-plugin');
    expect(typeof plugin.init).toBe('function');
    expect(typeof plugin.activate).toBe('function');
    expect(typeof plugin.deactivate).toBe('function');
  });

  it('loads plugin without lifecycle methods', async () => {
    const pluginDir = join(tempDir, 'minimal');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'index.js'), `
export default {
  manifest: { name: 'minimal', version: '1.0.0', description: 'Minimal', permissions: [] },
};
`);

    const discovered = { dir: pluginDir, manifest: { name: 'minimal', version: '1.0.0', description: 'Minimal', permissions: [] }, state: 'discovered' as const };
    const plugin = await loadPluginModule(discovered);
    expect(plugin.init).toBeUndefined();
    expect(plugin.activate).toBeUndefined();
  });
});
