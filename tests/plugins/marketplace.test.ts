import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginMarketplace } from '../../src/plugins/marketplace.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `xiaobai-marketplace-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PluginMarketplace', () => {
  it('constructs with default options', () => {
    const mp = new PluginMarketplace();
    expect((mp as any).registryUrl).toBe('https://registry.npmjs.org');
  });

  it('constructs with custom options', () => {
    const mp = new PluginMarketplace({ registryUrl: 'https://custom.com', localIndexDir: tempDir });
    expect((mp as any).registryUrl).toBe('https://custom.com');
  });

  it('returns empty list when no local index', async () => {
    const mp = new PluginMarketplace({ localIndexDir: tempDir });
    const list = await mp.list();
    expect(list).toEqual([]);
  });

  it('search returns empty when no index', async () => {
    const mp = new PluginMarketplace({ localIndexDir: tempDir });
    const results = await mp.search('test');
    expect(results).toEqual([]);
  });

  it('getByName returns undefined when not found', async () => {
    const mp = new PluginMarketplace({ localIndexDir: tempDir });
    const plugin = await mp.getByName('nonexistent');
    expect(plugin).toBeUndefined();
  });

  it('listByCategory returns empty when no index', async () => {
    const mp = new PluginMarketplace({ localIndexDir: tempDir });
    const plugins = await mp.listByCategory('tools');
    expect(plugins).toEqual([]);
  });

  it('invalidateCache clears cache', () => {
    const mp = new PluginMarketplace({ localIndexDir: tempDir });
    (mp as any).cache = { version: '1', plugins: [] };
    (mp as any).cacheExpiry = Date.now() + 10000;
    mp.invalidateCache();
    expect((mp as any).cache).toBeNull();
    expect((mp as any).cacheExpiry).toBe(0);
  });

  it('installFromGitHub validates format', async () => {
    const mp = new PluginMarketplace({ localIndexDir: tempDir });
    const result = await mp.installFromGitHub('invalid', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid format');
  });
});
