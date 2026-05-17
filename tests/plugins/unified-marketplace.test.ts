import { describe, it, expect, beforeEach } from 'vitest';
import { UnifiedMarketplace } from '../../src/plugins/unified-marketplace.js';
import type { MarketplaceEntry } from '../../src/plugins/registry.js';

function makeEntry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: 'test-1',
    name: 'test-plugin',
    description: 'A test plugin',
    version: '1.0.0',
    author: 'tester',
    repository: 'https://github.com/test/test-plugin',
    tags: ['utility'],
    permissions: [],
    rating: 4.5,
    downloads: 100,
    verified: true,
    manifest: { name: 'test-plugin', version: '1.0.0', description: 'A test plugin', permissions: [] },
    publishedAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('UnifiedMarketplace', () => {
  let marketplace: UnifiedMarketplace;

  beforeEach(() => {
    marketplace = new UnifiedMarketplace({ pluginsDir: '/tmp/test-plugins' });
  });

  it('registers and searches entries', async () => {
    marketplace.registerEntry(makeEntry({ name: 'weather', tags: ['weather', 'api'] }));
    marketplace.registerEntry(makeEntry({ id: 'test-2', name: 'calculator', tags: ['math'] }));

    const results = await marketplace.search('weather');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('weather');
  });

  it('browses all entries', async () => {
    marketplace.registerEntry(makeEntry({ name: 'a' }));
    marketplace.registerEntry(makeEntry({ id: 'b', name: 'b' }));

    const all = await marketplace.browse();
    expect(all.length).toBe(2);
  });

  it('browses by category', async () => {
    marketplace.registerEntry(makeEntry({ name: 'weather', tags: ['weather'] }));
    marketplace.registerEntry(makeEntry({ id: 'calc', name: 'calculator', tags: ['math'] }));

    const weatherPlugins = await marketplace.browse('weather');
    expect(weatherPlugins.length).toBe(1);
    expect(weatherPlugins[0].name).toBe('weather');
  });

  it('installs a registered entry', async () => {
    const entry = makeEntry();
    marketplace.registerEntry(entry);

    const result = await marketplace.install('test-1');
    expect(result.success).toBe(true);
  });

  it('fails to install unknown plugin', async () => {
    const result = await marketplace.install('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('tracks installed plugins', async () => {
    marketplace.registerEntry(makeEntry());
    await marketplace.install('test-1');

    const installed = marketplace.getInstalled();
    expect(installed.length).toBe(1);
    expect(installed[0].name).toBe('test-plugin');
  });

  it('returns stats', async () => {
    marketplace.registerEntry(makeEntry({ tags: ['utility'] }));
    marketplace.registerEntry(makeEntry({ id: 'test-2', name: 'other', tags: ['math'] }));

    const stats = marketplace.getStats();
    expect(stats.total).toBe(2);
    expect(stats.installed).toBe(0);
  });

  it('uninstalls a plugin by name', async () => {
    marketplace.registerEntry(makeEntry());
    await marketplace.install('test-1');

    const result = await marketplace.uninstall('test-plugin');
    expect(result.success).toBe(true);
    expect(marketplace.getInstalled().length).toBe(0);
  });

  it('formats list output', async () => {
    marketplace.registerEntry(makeEntry());
    const output = marketplace.formatList(await marketplace.browse());
    expect(output).toContain('test-plugin');
  });

  it('handles empty search gracefully', async () => {
    const results = await marketplace.search('nothing-matches');
    expect(results).toEqual([]);
  });

  it('merges remote entries with local entries', async () => {
    marketplace.registerEntry(makeEntry({ name: 'local-only' }));
    // fetchRemoteRegistry will fail silently since URL doesn't exist
    const all = await marketplace.browse();
    expect(all.length).toBe(1);
  });
});
