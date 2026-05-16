import { describe, it, expect } from 'vitest';
import { MarketplaceRegistry, type MarketplaceEntry } from '../../src/plugins/registry.js';
import type { PluginManifest } from '../../src/plugins/types.js';

const sampleManifest: PluginManifest = {
  name: 'test-plugin',
  version: '1.0.0',
  description: 'A test plugin',
  permissions: ['tools:register'],
};

function createEntry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    description: 'A test plugin',
    version: '1.0.0',
    author: 'test-author',
    repository: 'https://github.com/test/plugin',
    tags: ['testing', 'utility'],
    permissions: ['tools:register'],
    rating: 4.5,
    downloads: 100,
    verified: true,
    manifest: sampleManifest,
    publishedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

describe('MarketplaceRegistry', () => {
  let registry: MarketplaceRegistry;

  beforeEach(() => {
    registry = new MarketplaceRegistry();
  });

  describe('register', () => {
    it('should register a plugin entry', () => {
      const entry = createEntry();
      registry.register(entry);
      expect(registry.get('test-plugin')).toEqual(entry);
    });

    it('should overwrite existing entry', () => {
      registry.register(createEntry({ version: '1.0.0' }));
      registry.register(createEntry({ version: '2.0.0' }));
      expect(registry.get('test-plugin')?.version).toBe('2.0.0');
    });
  });

  describe('unregister', () => {
    it('should remove a plugin entry', () => {
      registry.register(createEntry());
      expect(registry.unregister('test-plugin')).toBe(true);
      expect(registry.get('test-plugin')).toBeUndefined();
    });

    it('should return false for non-existent entry', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      registry.register(createEntry({ id: 'alpha', name: 'Alpha', tags: ['coding'], rating: 4.0, downloads: 50 }));
      registry.register(createEntry({ id: 'beta', name: 'Beta Tool', tags: ['testing'], rating: 4.8, downloads: 200 }));
      registry.register(createEntry({ id: 'gamma', name: 'Gamma', tags: ['coding', 'ai'], rating: 3.5, downloads: 10, author: 'special-author' }));
    });

    it('should search by query', () => {
      const results = registry.search({ query: 'alpha' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('alpha');
    });

    it('should search by tags', () => {
      const results = registry.search({ tags: ['coding'] });
      expect(results.length).toBe(2);
    });

    it('should search by author', () => {
      const results = registry.search({ author: 'special-author' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('gamma');
    });

    it('should sort by rating', () => {
      const results = registry.search({ sortBy: 'rating' });
      expect(results[0].id).toBe('beta');
    });

    it('should sort by downloads', () => {
      const results = registry.search({ sortBy: 'downloads' });
      expect(results[0].id).toBe('beta');
    });

    it('should sort by name', () => {
      const results = registry.search({ sortBy: 'name' });
      expect(results[0].id).toBe('alpha');
    });

    it('should paginate results', () => {
      const page1 = registry.search({ limit: 2, offset: 0 });
      const page2 = registry.search({ limit: 2, offset: 2 });
      expect(page1.length).toBe(2);
      expect(page2.length).toBe(1);
    });
  });

  describe('install', () => {
    it('should install a registered plugin', async () => {
      registry.register(createEntry());
      const result = await registry.install('test-plugin');
      expect(result.success).toBe(true);
      expect(registry.isInstalled('test-plugin')).toBe(true);
    });

    it('should fail for non-existent plugin', async () => {
      const result = await registry.install('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail for already installed plugin', async () => {
      registry.register(createEntry());
      await registry.install('test-plugin');
      const result = await registry.install('test-plugin');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already installed');
    });
  });

  describe('uninstall', () => {
    it('should uninstall an installed plugin', async () => {
      registry.register(createEntry());
      await registry.install('test-plugin');
      const result = await registry.uninstall('test-plugin');
      expect(result.success).toBe(true);
      expect(registry.isInstalled('test-plugin')).toBe(false);
    });

    it('should fail for non-installed plugin', async () => {
      const result = await registry.uninstall('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not installed');
    });
  });

  describe('getInstalled', () => {
    it('should list installed plugins', async () => {
      registry.register(createEntry({ id: 'a' }));
      registry.register(createEntry({ id: 'b' }));
      await registry.install('a');
      await registry.install('b');
      expect(registry.getInstalled().length).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return registry statistics', () => {
      registry.register(createEntry({ id: 'a', tags: ['coding'] }));
      registry.register(createEntry({ id: 'b', tags: ['coding', 'testing'] }));
      const stats = registry.getStats();
      expect(stats.total).toBe(2);
      expect(stats.installed).toBe(0);
      expect(stats.categories.get('coding')).toBe(2);
      expect(stats.categories.get('testing')).toBe(1);
    });
  });

  describe('formatList', () => {
    it('should format plugin list', () => {
      registry.register(createEntry({ id: 'a', name: 'Alpha' }));
      const output = registry.formatList(registry.listAll());
      expect(output).toContain('Alpha');
      expect(output).toContain('v1.0.0');
    });

    it('should handle empty list', () => {
      expect(registry.formatList([])).toContain('No plugins found');
    });

    it('should mark installed plugins', async () => {
      registry.register(createEntry({ id: 'a', name: 'Alpha' }));
      await registry.install('a');
      const output = registry.formatList(registry.listAll());
      expect(output).toContain('[installed]');
    });
  });
});