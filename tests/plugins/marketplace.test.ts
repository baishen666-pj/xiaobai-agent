import { describe, it, expect } from 'vitest';
import { PluginMarketplace, type MarketplaceManifest } from '../../src/plugins/marketplace.js';

describe('PluginMarketplace', () => {
  it('constructs with default URL', () => {
    const mp = new PluginMarketplace();
    expect((mp as any).registryUrl).toBe('https://xiaobai.dev/api/plugins');
  });

  it('constructs with custom URL', () => {
    const mp = new PluginMarketplace('https://custom.registry.com/plugins');
    expect((mp as any).registryUrl).toBe('https://custom.registry.com/plugins');
  });

  it('returns empty list when registry unreachable', async () => {
    const mp = new PluginMarketplace('http://localhost:1/nonexistent');
    const list = await mp.list();
    expect(list).toEqual([]);
  });

  it('search returns empty when unreachable', async () => {
    const mp = new PluginMarketplace('http://localhost:1/nonexistent');
    const results = await mp.search('test');
    expect(results).toEqual([]);
  });

  it('getByName returns undefined when unreachable', async () => {
    const mp = new PluginMarketplace('http://localhost:1/nonexistent');
    const plugin = await mp.getByName('nonexistent');
    expect(plugin).toBeUndefined();
  });

  it('listByCategory returns empty when unreachable', async () => {
    const mp = new PluginMarketplace('http://localhost:1/nonexistent');
    const plugins = await mp.listByCategory('tools');
    expect(plugins).toEqual([]);
  });

  it('invalidateCache clears cache', () => {
    const mp = new PluginMarketplace();
    (mp as any).cache = { version: '1', plugins: [] };
    (mp as any).cacheExpiry = Date.now() + 10000;
    mp.invalidateCache();
    expect((mp as any).cache).toBeNull();
    expect((mp as any).cacheExpiry).toBe(0);
  });
});
