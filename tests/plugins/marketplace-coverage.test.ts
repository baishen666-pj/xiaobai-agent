import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginMarketplace } from '../../src/plugins/marketplace.js';
import type { MarketplacePlugin, MarketplaceManifest } from '../../src/plugins/marketplace.js';
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
let indexDir: string;

function writeIndex(plugins: MarketplacePlugin[]): void {
  writeFileSync(
    join(indexDir, 'index.json'),
    JSON.stringify({
      version: '1',
      updatedAt: new Date().toISOString(),
      plugins,
    }),
    'utf-8',
  );
}

function makePlugin(overrides: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    name: 'test-plugin',
    description: 'A test plugin',
    author: 'test-author',
    version: '1.0.0',
    category: 'tool',
    sourcePath: '/path/to/plugin',
    ...overrides,
  };
}

beforeEach(() => {
  tempDir = join(tmpdir(), `xiaobai-marketplace-cov-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  indexDir = join(tempDir, 'index');
  mkdirSync(indexDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------
describe('PluginMarketplace - construction', () => {
  it('uses default registryUrl when none provided', () => {
    const mp = new PluginMarketplace();
    expect((mp as any).registryUrl).toBe('https://registry.npmjs.org');
  });

  it('uses custom registryUrl', () => {
    const mp = new PluginMarketplace({ registryUrl: 'https://custom.registry.com' });
    expect((mp as any).registryUrl).toBe('https://custom.registry.com');
  });

  it('uses default localIndexDir when none provided', () => {
    const mp = new PluginMarketplace();
    expect((mp as any).localIndexDir).toContain('.xiaobai');
  });

  it('uses custom localIndexDir', () => {
    const mp = new PluginMarketplace({ localIndexDir: '/tmp/custom' });
    expect((mp as any).localIndexDir).toBe('/tmp/custom');
  });

  it('initializes with null cache and zero expiry', () => {
    const mp = new PluginMarketplace();
    expect((mp as any).cache).toBeNull();
    expect((mp as any).cacheExpiry).toBe(0);
  });

  it('sets default cacheTtl to 1 hour', () => {
    const mp = new PluginMarketplace();
    expect((mp as any).cacheTtl).toBe(3600_000);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
describe('PluginMarketplace - list', () => {
  it('returns empty array when index file does not exist', async () => {
    const mp = new PluginMarketplace({ localIndexDir: join(tempDir, 'no-index') });
    const result = await mp.list();
    expect(result).toEqual([]);
  });

  it('returns all plugins when no query is provided', async () => {
    const plugins = [
      makePlugin({ name: 'a' }),
      makePlugin({ name: 'b' }),
      makePlugin({ name: 'c' }),
    ];
    writeIndex(plugins);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list();
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.name)).toEqual(['a', 'b', 'c']);
  });

  it('returns all plugins when query is empty string', async () => {
    writeIndex([makePlugin({ name: 'p1' }), makePlugin({ name: 'p2' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('');
    expect(result).toHaveLength(2);
  });

  it('filters by plugin name (case insensitive)', async () => {
    writeIndex([
      makePlugin({ name: 'CodeLinter' }),
      makePlugin({ name: 'Formatter' }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('codelinter');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('CodeLinter');
  });

  it('filters by description (case insensitive)', async () => {
    writeIndex([
      makePlugin({ name: 'p1', description: 'A GREAT tool for developers' }),
      makePlugin({ name: 'p2', description: 'A mediocre tool' }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('great');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('p1');
  });

  it('filters by tags', async () => {
    writeIndex([
      makePlugin({ name: 'p1', tags: ['typescript', 'linting'] }),
      makePlugin({ name: 'p2', tags: ['python'] }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('typescript');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('p1');
  });

  it('returns empty when no plugins match query', async () => {
    writeIndex([makePlugin({ name: 'alpha' }), makePlugin({ name: 'beta' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('nonexistent');
    expect(result).toEqual([]);
  });

  it('handles plugins without tags field', async () => {
    writeIndex([
      makePlugin({ name: 'no-tags', tags: undefined }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    // Should not throw when tags is undefined
    const result = await mp.list('anything');
    expect(result).toEqual([]);
  });

  it('matches partial name', async () => {
    writeIndex([
      makePlugin({ name: 'super-linter-pro' }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('linter');
    expect(result).toHaveLength(1);
  });

  it('matches partial description', async () => {
    writeIndex([
      makePlugin({ name: 'p1', description: 'Automated code review tool' }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('review');
    expect(result).toHaveLength(1);
  });

  it('matches partial tag', async () => {
    writeIndex([
      makePlugin({ name: 'p1', tags: ['javascript'] }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('java');
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------
describe('PluginMarketplace - search', () => {
  it('delegates to list with query', async () => {
    writeIndex([
      makePlugin({ name: 'search-target', description: 'Find me' }),
      makePlugin({ name: 'other' }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.search('search');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('search-target');
  });

  it('returns empty when no results found', async () => {
    writeIndex([makePlugin({ name: 'alpha' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.search('xyz');
    expect(result).toEqual([]);
  });

  it('returns all plugins when search query matches everything', async () => {
    writeIndex([
      makePlugin({ name: 'tool-a', description: 'tool' }),
      makePlugin({ name: 'tool-b', description: 'tool' }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.search('tool');
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getByName
// ---------------------------------------------------------------------------
describe('PluginMarketplace - getByName', () => {
  it('returns exact name match', async () => {
    writeIndex([
      makePlugin({ name: 'exact-match' }),
      makePlugin({ name: 'exact-match-pro' }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.getByName('exact-match');
    expect(result).toBeDefined();
    expect(result!.name).toBe('exact-match');
  });

  it('returns undefined for no match', async () => {
    writeIndex([makePlugin({ name: 'only-one' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    expect(await mp.getByName('does-not-exist')).toBeUndefined();
  });

  it('returns first match when duplicates exist', async () => {
    writeIndex([
      makePlugin({ name: 'dup', version: '1.0.0' }),
      makePlugin({ name: 'dup', version: '2.0.0' }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.getByName('dup');
    expect(result).toBeDefined();
    expect(result!.version).toBe('1.0.0');
  });

  it('returns undefined when index is empty', async () => {
    writeIndex([]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    expect(await mp.getByName('anything')).toBeUndefined();
  });

  it('is case sensitive', async () => {
    writeIndex([makePlugin({ name: 'CaseSensitive' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    expect(await mp.getByName('casesensitive')).toBeUndefined();
    expect(await mp.getByName('CaseSensitive')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// listByCategory
// ---------------------------------------------------------------------------
describe('PluginMarketplace - listByCategory', () => {
  it('returns plugins matching exact category', async () => {
    writeIndex([
      makePlugin({ name: 'a', category: 'tool' }),
      makePlugin({ name: 'b', category: 'util' }),
      makePlugin({ name: 'c', category: 'tool' }),
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const tools = await mp.listByCategory('tool');
    expect(tools).toHaveLength(2);
    expect(tools.map((p) => p.name)).toEqual(['a', 'c']);
  });

  it('returns empty for category with no plugins', async () => {
    writeIndex([makePlugin({ name: 'a', category: 'tool' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    expect(await mp.listByCategory('nonexistent')).toEqual([]);
  });

  it('is case sensitive', async () => {
    writeIndex([makePlugin({ name: 'a', category: 'Tool' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    expect(await mp.listByCategory('tool')).toHaveLength(0);
    expect(await mp.listByCategory('Tool')).toHaveLength(1);
  });

  it('returns empty when no index exists', async () => {
    const mp = new PluginMarketplace({ localIndexDir: join(tempDir, 'no-index') });
    expect(await mp.listByCategory('tool')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// installFromGitHub
// ---------------------------------------------------------------------------
describe('PluginMarketplace - installFromGitHub', () => {
  it('rejects format without owner/repo', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('single-word', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid format');
  });

  it('rejects empty string', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('', tempDir);
    expect(result.success).toBe(false);
  });

  it('strips github: prefix and parses owner/repo', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('github:evil$owner/repo', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('rejects invalid characters in owner', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('github:own`er/repo', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid owner or repo name');
  });

  it('rejects invalid characters in repo name', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('github:owner/re`po', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid owner or repo name');
  });

  it('rejects when plugin directory already exists', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const existingDir = join(tempDir, 'existing-repo');
    mkdirSync(existingDir, { recursive: true });
    const result = await mp.installFromGitHub('github:owner/existing-repo', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('accepts valid owner/repo with hyphens and dots', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    // This will fail at git clone but should pass validation
    const result = await mp.installFromGitHub('github:my-org/plugin-name.v2', tempDir);
    // Fails at clone since there's no actual repo, but validation passed
    expect(result.success).toBe(false);
    expect(result.error).toContain('Clone failed');
  });

  it('accepts underscores in owner/repo', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('github:my_org/my_plugin', tempDir);
    expect(result.success).toBe(false);
    // Should fail at clone, not validation
    expect(result.error).not.toContain('Invalid');
  });

  it('handles git clone failure gracefully', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('github:nonexistent/repo-that-does-not-exist-12345', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Clone failed');
  });
});

// ---------------------------------------------------------------------------
// installFromNpm
// ---------------------------------------------------------------------------
describe('PluginMarketplace - installFromNpm', () => {
  it('rejects package name with spaces', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromNpm('bad package name', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid package name');
  });

  it('rejects package name with special characters', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromNpm('pkg!name', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid package name');
  });

  it('strips npm: prefix from package name', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromNpm('npm:some-package', tempDir);
    // Should fail at npm pack, not at validation
    expect(result.success).toBe(false);
    expect(result.error).toContain('npm install failed');
  });

  it('accepts scoped package names', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromNpm('@scope/package', tempDir);
    // Should fail at npm pack, not at validation
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('Invalid');
  });

  it('accepts package names with hyphens, dots, and underscores', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromNpm('my_pkg.v2-beta', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('Invalid');
  });

  it('sanitizes directory name by replacing slashes and at-signs', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    // @scope/package becomes _scope__package in directory name
    // We verify it doesn't crash
    const result = await mp.installFromNpm('@scope/package', tempDir);
    expect(typeof result.success).toBe('boolean');
  });

  it('handles npm pack failure gracefully', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromNpm('definitely-not-a-real-package-xyz-999', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('npm install failed');
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------
describe('PluginMarketplace - caching', () => {
  it('caches index after first read', async () => {
    writeIndex([makePlugin({ name: 'cached' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });

    // First call reads from disk
    const first = await mp.list();
    expect(first).toHaveLength(1);

    // Overwrite the index on disk
    writeIndex([makePlugin({ name: 'cached' }), makePlugin({ name: 'new-one' })]);

    // Second call should return cached result
    const second = await mp.list();
    expect(second).toHaveLength(1);
  });

  it('cache respects TTL', async () => {
    writeIndex([makePlugin({ name: 'original' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });

    // Load into cache
    await mp.list();

    // Set cache as expired
    (mp as any).cacheExpiry = Date.now() - 1;

    // Update index on disk
    writeIndex([makePlugin({ name: 'updated' })]);

    // Should reload because cache expired
    const result = await mp.list();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('updated');
  });

  it('invalidateCache clears cache and expiry', () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    (mp as any).cache = { version: '1', plugins: [] };
    (mp as any).cacheExpiry = Date.now() + 100000;
    mp.invalidateCache();
    expect((mp as any).cache).toBeNull();
    expect((mp as any).cacheExpiry).toBe(0);
  });

  it('invalidateCache allows fresh read on next call', async () => {
    writeIndex([makePlugin({ name: 'old' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    await mp.list();

    writeIndex([makePlugin({ name: 'fresh' })]);
    mp.invalidateCache();
    const result = await mp.list();
    expect(result[0].name).toBe('fresh');
  });

  it('cache is invalidated after saveLocalIndex', async () => {
    writeIndex([makePlugin({ name: 'initial' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });

    // Load cache
    await mp.list();
    expect((mp as any).cache).not.toBeNull();

    // Simulate an add operation that calls saveLocalIndex internally
    // by attempting an install that modifies the index
    // This tests that saveLocalIndex sets cache to null
    const saveFn = (mp as any).saveLocalIndex.bind(mp);
    saveFn({ version: '1', updatedAt: new Date().toISOString(), plugins: [makePlugin({ name: 'saved' })] });

    expect((mp as any).cache).toBeNull();
    expect((mp as any).cacheExpiry).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Local index persistence
// ---------------------------------------------------------------------------
describe('PluginMarketplace - local index persistence', () => {
  it('creates index directory if it does not exist', () => {
    const newDir = join(tempDir, 'brand-new-dir', 'nested');
    const mp = new PluginMarketplace({ localIndexDir: newDir });
    const saveFn = (mp as any).saveLocalIndex.bind(mp);
    saveFn({
      version: '1',
      updatedAt: new Date().toISOString(),
      plugins: [makePlugin({ name: 'created' })],
    });
    expect(existsSync(join(newDir, 'index.json'))).toBe(true);
  });

  it('writes valid JSON to index file', () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const plugin = makePlugin({ name: 'written' });
    const saveFn = (mp as any).saveLocalIndex.bind(mp);
    saveFn({
      version: '1',
      updatedAt: '2024-01-01T00:00:00.000Z',
      plugins: [plugin],
    });
    const raw = readFileSync(join(indexDir, 'index.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0].name).toBe('written');
  });

  it('updates updatedAt on save', () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const saveFn = (mp as any).saveLocalIndex.bind(mp);
    const before = new Date().toISOString();
    saveFn({
      version: '1',
      updatedAt: '2020-01-01T00:00:00.000Z',
      plugins: [],
    });
    const raw = readFileSync(join(indexDir, 'index.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// getLocalIndexSync
// ---------------------------------------------------------------------------
describe('PluginMarketplace - getLocalIndexSync', () => {
  it('returns empty manifest when index file does not exist', () => {
    const mp = new PluginMarketplace({ localIndexDir: join(tempDir, 'no-such-dir') });
    const result = (mp as any).getLocalIndexSync();
    expect(result.version).toBe('1');
    expect(result.plugins).toEqual([]);
    expect(result.updatedAt).toBeDefined();
  });

  it('returns parsed manifest from valid JSON', () => {
    const plugin = makePlugin({ name: 'from-disk' });
    writeIndex([plugin]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = (mp as any).getLocalIndexSync();
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].name).toBe('from-disk');
  });

  it('returns empty manifest for corrupted JSON', () => {
    writeFileSync(join(indexDir, 'index.json'), '{{{invalid json}}}', 'utf-8');
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = (mp as any).getLocalIndexSync();
    expect(result.version).toBe('1');
    expect(result.plugins).toEqual([]);
  });

  it('returns empty manifest for empty file', () => {
    writeFileSync(join(indexDir, 'index.json'), '', 'utf-8');
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = (mp as any).getLocalIndexSync();
    expect(result.plugins).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addToLocalIndex
// ---------------------------------------------------------------------------
describe('PluginMarketplace - addToLocalIndex', () => {
  it('adds new plugin to empty index', () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const plugin = makePlugin({ name: 'new-plugin' });
    (mp as any).addToLocalIndex(plugin);

    const raw = readFileSync(join(indexDir, 'index.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0].name).toBe('new-plugin');
  });

  it('replaces existing plugin with same name', () => {
    writeIndex([makePlugin({ name: 'existing', version: '1.0.0' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });

    const updated = makePlugin({ name: 'existing', version: '2.0.0' });
    (mp as any).addToLocalIndex(updated);

    const raw = readFileSync(join(indexDir, 'index.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0].version).toBe('2.0.0');
  });

  it('appends plugin with different name', () => {
    writeIndex([makePlugin({ name: 'first' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });

    (mp as any).addToLocalIndex(makePlugin({ name: 'second' }));

    const raw = readFileSync(join(indexDir, 'index.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.plugins).toHaveLength(2);
  });

  it('invalidates cache after adding', () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    // Set fake cache
    (mp as any).cache = { version: '1', plugins: [] };
    (mp as any).cacheExpiry = Date.now() + 10000;

    (mp as any).addToLocalIndex(makePlugin({ name: 'cache-bust' }));

    expect((mp as any).cache).toBeNull();
    expect((mp as any).cacheExpiry).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('PluginMarketplace - edge cases', () => {
  it('handles index with extra fields gracefully', async () => {
    writeFileSync(
      join(indexDir, 'index.json'),
      JSON.stringify({
        version: '1',
        updatedAt: new Date().toISOString(),
        plugins: [{ name: 'extra', description: 'd', author: 'a', version: '1', category: 'c', sourcePath: '/s', extraField: 'ignored' }],
      }),
      'utf-8',
    );
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('extra');
  });

  it('handles plugin with all optional fields populated', async () => {
    writeIndex([{
      name: 'full',
      description: 'Full plugin',
      author: 'author',
      version: '3.0.0',
      category: 'integration',
      sourcePath: '/path',
      homepage: 'https://example.com',
      repository: 'https://github.com/example/repo',
      tags: ['tag1', 'tag2'],
      downloads: 5000,
      rating: 4.5,
    }]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const plugin = await mp.getByName('full');
    expect(plugin).toBeDefined();
    expect(plugin!.homepage).toBe('https://example.com');
    expect(plugin!.repository).toBe('https://github.com/example/repo');
    expect(plugin!.tags).toEqual(['tag1', 'tag2']);
    expect(plugin!.downloads).toBe(5000);
    expect(plugin!.rating).toBe(4.5);
  });

  it('handles concurrent reads from same instance', async () => {
    writeIndex([makePlugin({ name: 'concurrent' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const [r1, r2, r3] = await Promise.all([
      mp.list(),
      mp.search('concurrent'),
      mp.getByName('concurrent'),
    ]);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r3).toBeDefined();
  });

  it('handles list after invalidateCache with no index file', async () => {
    const mp = new PluginMarketplace({ localIndexDir: join(tempDir, 'empty') });
    mp.invalidateCache();
    const result = await mp.list();
    expect(result).toEqual([]);
  });

  it('handles search query that matches description but not name', async () => {
    writeIndex([makePlugin({ name: 'xyz', description: 'This is a build automation tool' })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.search('automation');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('xyz');
  });

  it('handles search query that matches tag only', async () => {
    writeIndex([makePlugin({ name: 'abc', description: 'Unrelated', tags: ['secret-tag'] })]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.search('secret-tag');
    expect(result).toHaveLength(1);
  });

  it('listByCategory with empty index returns empty', async () => {
    writeIndex([]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.listByCategory('anything');
    expect(result).toEqual([]);
  });

  it('installFromGitHub with only owner and no repo', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('github:owneronly', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid format');
  });

  it('installFromGitHub with too many slashes', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('github:owner/repo/extra', tempDir);
    // owner=owner, repoName=repo -- extra is ignored by split('/')
    // This actually passes validation since owner and repoName are valid
    // but will fail at git clone
    expect(result.success).toBe(false);
  });
});
