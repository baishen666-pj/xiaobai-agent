import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginMarketplace } from '../../src/plugins/marketplace.js';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
let indexDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-marketplace-test-'));
  indexDir = join(tempDir, 'index');
  mkdirSync(indexDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeIndex(plugins: any[]) {
  writeFileSync(join(indexDir, 'index.json'), JSON.stringify({
    version: '1',
    updatedAt: new Date().toISOString(),
    plugins,
  }), 'utf-8');
}

describe('PluginMarketplace', () => {
  it('list returns empty when no index', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const plugins = await mp.list();
    expect(plugins).toEqual([]);
  });

  it('list returns all plugins when no query', async () => {
    writeIndex([
      { name: 'plugin-a', description: 'A plugin', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/a' },
      { name: 'plugin-b', description: 'B plugin', author: 'dev', version: '2.0.0', category: 'util', sourcePath: '/b' },
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const plugins = await mp.list();
    expect(plugins).toHaveLength(2);
  });

  it('list filters by query', async () => {
    writeIndex([
      { name: 'linter', description: 'Code linter', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/linter' },
      { name: 'formatter', description: 'Code formatter', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/formatter' },
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('lint');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('linter');
  });

  it('list filters by tags', async () => {
    writeIndex([
      { name: 'p1', description: 'Plugin', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/p1', tags: ['ai', 'llm'] },
      { name: 'p2', description: 'Plugin', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/p2', tags: ['devops'] },
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.list('ai');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('p1');
  });

  it('search is alias for list with query', async () => {
    writeIndex([
      { name: 'search-tool', description: 'Search', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/s' },
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.search('search');
    expect(result).toHaveLength(1);
  });

  it('getByName returns matching plugin', async () => {
    writeIndex([
      { name: 'target', description: 'Target', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/t' },
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const plugin = await mp.getByName('target');
    expect(plugin).toBeDefined();
    expect(plugin!.name).toBe('target');
  });

  it('getByName returns undefined for missing plugin', async () => {
    writeIndex([]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    expect(await mp.getByName('missing')).toBeUndefined();
  });

  it('listByCategory filters correctly', async () => {
    writeIndex([
      { name: 'a', description: 'A', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/a' },
      { name: 'b', description: 'B', author: 'dev', version: '1.0.0', category: 'util', sourcePath: '/b' },
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const tools = await mp.listByCategory('tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('a');
  });

  it('installFromGitHub validates format', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('invalid-format', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid format');
  });

  it('installFromGitHub rejects invalid characters', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromGitHub('github:evil$hack/repo', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('installFromNpm validates package name', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const result = await mp.installFromNpm('package with spaces', tempDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('installFromNpm strips npm: prefix', async () => {
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    // Will fail because npm pack won't work, but should accept the name format
    const result = await mp.installFromNpm('npm:some-package', tempDir);
    expect(result.success).toBe(false);
    // Error should be about npm pack, not name validation
    expect(result.error).toContain('npm install failed');
  });

  it('caches index between calls', async () => {
    writeIndex([
      { name: 'cached', description: 'Cached', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/c' },
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const first = await mp.list();
    // Modify index on disk
    writeIndex([
      { name: 'cached', description: 'Cached', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/c' },
      { name: 'new', description: 'New', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/n' },
    ]);
    const second = await mp.list();
    // Cache should still return old data
    expect(second).toHaveLength(1);
  });

  it('invalidateCache forces reload', async () => {
    writeIndex([
      { name: 'old', description: 'Old', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/o' },
    ]);
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    await mp.list();
    writeIndex([
      { name: 'new', description: 'New', author: 'dev', version: '1.0.0', category: 'tool', sourcePath: '/n' },
    ]);
    mp.invalidateCache();
    const result = await mp.list();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('new');
  });

  it('handles corrupted index.json gracefully', async () => {
    writeFileSync(join(indexDir, 'index.json'), 'bad json{{{', 'utf-8');
    const mp = new PluginMarketplace({ localIndexDir: indexDir });
    const plugins = await mp.list();
    expect(plugins).toEqual([]);
  });
});
