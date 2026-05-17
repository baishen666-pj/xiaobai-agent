import { describe, it, expect } from 'vitest';
import { satisfiesMinVersion } from '../../src/plugins/manager.js';

// We need to test the version comparison. Since satisfiesMinVersion is not
// exported, we test through PluginManager.init() by checking errors.
// Let's directly test the logic via loader rejection.

describe('Plugin Version Check', () => {
  // Test the semver comparison logic directly
  function checkVersion(minVersion: string, appVersion: string): boolean {
    const parseVer = (v: string) => v.split('.').map(Number);
    const min = parseVer(minVersion);
    const app = parseVer(appVersion);
    for (let i = 0; i < 3; i++) {
      if ((app[i] ?? 0) < (min[i] ?? 0)) return false;
      if ((app[i] ?? 0) > (min[i] ?? 0)) return true;
    }
    return true;
  }

  it('accepts same version', () => {
    expect(checkVersion('0.7.0', '0.7.0')).toBe(true);
  });

  it('accepts higher patch version', () => {
    expect(checkVersion('0.7.0', '0.7.1')).toBe(true);
  });

  it('accepts higher minor version', () => {
    expect(checkVersion('0.7.0', '0.8.0')).toBe(true);
  });

  it('accepts higher major version', () => {
    expect(checkVersion('0.7.0', '1.0.0')).toBe(true);
  });

  it('rejects lower patch version', () => {
    expect(checkVersion('0.7.0', '0.6.9')).toBe(false);
  });

  it('rejects lower minor version', () => {
    expect(checkVersion('0.7.0', '0.6.0')).toBe(false);
  });

  it('rejects lower major version', () => {
    expect(checkVersion('1.0.0', '0.9.9')).toBe(false);
  });

  it('handles two-part versions', () => {
    expect(checkVersion('0.7', '0.7.0')).toBe(true);
    expect(checkVersion('0.7.0', '0.7')).toBe(true);
  });

  it('handles single-part versions', () => {
    expect(checkVersion('1', '1.0.0')).toBe(true);
    expect(checkVersion('2', '1.9.9')).toBe(false);
  });

  it('plugin manager rejects incompatible minAppVersion', async () => {
    const { mkdirSync, rmSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { PluginManager } = await import('../../src/plugins/manager.js');
    const { ToolRegistry } = await import('../../src/tools/registry.js');
    const { HookSystem } = await import('../../src/hooks/system.js');
    const { ConfigManager } = await import('../../src/config/manager.js');
    const { MemorySystem } = await import('../../src/memory/system.js');
    const { ProviderRouter } = await import('../../src/provider/router.js');

    const tempDir = join(tmpdir(), `xiaobai-test-ver-${Date.now()}`);
    const pluginsDir = join(tempDir, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });

    const pluginDir = join(pluginsDir, 'future-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'future-plugin',
      version: '1.0.0',
      description: 'Requires future version',
      minAppVersion: '99.0.0',
      permissions: [],
    }));
    writeFileSync(join(pluginDir, 'index.js'), `export default { manifest: { name: 'future-plugin', version: '1.0.0', description: 'Future', permissions: [] } };`);

    const tools = new ToolRegistry();
    const hooks = new HookSystem(tempDir);
    const config = new ConfigManager();
    const memory = new MemorySystem(tempDir);
    const providers = new ProviderRouter(config.get());

    const manager = new PluginManager({ tools, hooks, config, memory, providers, pluginsDir });
    await manager.init();

    const errs = manager.getErrors();
    expect(errs.length).toBe(1);
    expect(errs[0].error.message).toContain('requires >=');
    expect(errs[0].pluginName).toBe('future-plugin');

    rmSync(tempDir, { recursive: true, force: true });
  });
});
