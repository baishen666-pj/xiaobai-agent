import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentMarketplace, type AgentMarketplaceEntry } from '../../src/protocols/agent-marketplace.js';

function createEntry(overrides: Partial<AgentMarketplaceEntry> = {}): AgentMarketplaceEntry {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'A test agent',
    protocol: 'a2a',
    url: 'http://localhost:3000',
    author: 'test-author',
    version: '1.0.0',
    rating: 4.5,
    verified: true,
    tags: ['testing', 'demo'],
    ...overrides,
  };
}

describe('AgentMarketplace', () => {
  let marketplace: AgentMarketplace;

  beforeEach(() => {
    marketplace = new AgentMarketplace();
  });

  it('register and list all entries', () => {
    const entry1 = createEntry({ id: 'a1', name: 'Agent One' });
    const entry2 = createEntry({ id: 'a2', name: 'Agent Two' });

    marketplace.register(entry1);
    marketplace.register(entry2);

    const all = marketplace.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.id)).toEqual(['a1', 'a2']);
  });

  it('search by query matches name/description/tags', () => {
    marketplace.register(createEntry({ id: 'a1', name: 'Code Reviewer', description: 'Reviews code', tags: ['code'] }));
    marketplace.register(createEntry({ id: 'a2', name: 'Data Analyst', description: 'Analyzes data sets', tags: ['analytics'] }));
    marketplace.register(createEntry({ id: 'a3', name: 'Security Scanner', description: 'Scans for vulnerabilities', tags: ['security', 'code-audit'] }));

    const byName = marketplace.search('reviewer');
    expect(byName).toHaveLength(1);
    expect(byName[0].id).toBe('a1');

    const byDescription = marketplace.search('data');
    expect(byDescription).toHaveLength(1);
    expect(byDescription[0].id).toBe('a2');

    const byTag = marketplace.search('security');
    expect(byTag).toHaveLength(1);
    expect(byTag[0].id).toBe('a3');
  });

  it('search is case-insensitive', () => {
    marketplace.register(createEntry({ id: 'a1', name: 'CODE Reviewer', tags: [] }));

    const results = marketplace.search('code');
    expect(results).toHaveLength(1);
  });

  it('browse by tag filters correctly', () => {
    marketplace.register(createEntry({ id: 'a1', name: 'Agent A', tags: ['testing', 'unit'] }));
    marketplace.register(createEntry({ id: 'a2', name: 'Agent B', tags: ['production'] }));
    marketplace.register(createEntry({ id: 'a3', name: 'Agent C', tags: ['testing'] }));

    const testing = marketplace.browse('testing');
    expect(testing).toHaveLength(2);
    expect(testing.map((e) => e.id)).toEqual(['a1', 'a3']);

    const production = marketplace.browse('production');
    expect(production).toHaveLength(1);
    expect(production[0].id).toBe('a2');
  });

  it('browse without tag returns all entries', () => {
    marketplace.register(createEntry({ id: 'a1' }));
    marketplace.register(createEntry({ id: 'a2' }));

    const all = marketplace.browse();
    expect(all).toHaveLength(2);
  });

  it('get returns entry by id', () => {
    const entry = createEntry({ id: 'my-agent' });
    marketplace.register(entry);

    expect(marketplace.get('my-agent')).toEqual(entry);
    expect(marketplace.get('nonexistent')).toBeUndefined();
  });

  it('unregister removes entry', () => {
    marketplace.register(createEntry({ id: 'a1' }));

    expect(marketplace.unregister('a1')).toBe(true);
    expect(marketplace.get('a1')).toBeUndefined();
    expect(marketplace.listAll()).toHaveLength(0);
  });

  it('unregister returns false for unknown id', () => {
    expect(marketplace.unregister('nonexistent')).toBe(false);
  });

  it('install calls bridge.registerAgent', async () => {
    const bridge = {
      registerAgent: vi.fn().mockResolvedValue(undefined),
    };
    marketplace.setBridge(bridge as any);

    marketplace.register(createEntry({ id: 'a1', name: 'My Agent', protocol: 'a2a', url: 'http://localhost:3000', role: 'reviewer' }));

    const result = await marketplace.install('a1');

    expect(result.success).toBe(true);
    expect(bridge.registerAgent).toHaveBeenCalledWith({
      name: 'My Agent',
      url: 'http://localhost:3000',
      protocol: 'a2a',
      role: 'reviewer',
    });
    expect(marketplace.isInstalled('a1')).toBe(true);
  });

  it('install without bridge returns error', async () => {
    marketplace.register(createEntry({ id: 'a1' }));

    const result = await marketplace.install('a1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No remote agent bridge');
  });

  it('install unknown entry returns error', async () => {
    const bridge = {
      registerAgent: vi.fn().mockResolvedValue(undefined),
    };
    marketplace.setBridge(bridge as any);

    const result = await marketplace.install('nonexistent');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(bridge.registerAgent).not.toHaveBeenCalled();
  });

  it('install handles bridge error', async () => {
    const bridge = {
      registerAgent: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    marketplace.setBridge(bridge as any);
    marketplace.register(createEntry({ id: 'a1' }));

    const result = await marketplace.install('a1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('connection refused');
    expect(marketplace.isInstalled('a1')).toBe(false);
  });

  it('getStats returns correct counts', () => {
    marketplace.register(createEntry({ id: 'a1' }));
    marketplace.register(createEntry({ id: 'a2' }));

    expect(marketplace.getStats()).toEqual({ total: 2, installed: 0 });

    const bridge = { registerAgent: vi.fn().mockResolvedValue(undefined) };
    marketplace.setBridge(bridge as any);
    marketplace.register(createEntry({ id: 'a3' }));
    // install a1 manually via the installed set (indirectly)
    // We install via the marketplace to move the counter
    marketplace.register(createEntry({ id: 'a3', name: 'A3', protocol: 'a2a', url: 'http://localhost:3000' }));
  });

  it('getStats tracks installed count after install', async () => {
    const bridge = { registerAgent: vi.fn().mockResolvedValue(undefined) };
    marketplace.setBridge(bridge as any);
    marketplace.register(createEntry({ id: 'a1' }));
    marketplace.register(createEntry({ id: 'a2' }));

    await marketplace.install('a1');

    const stats = marketplace.getStats();
    expect(stats.total).toBe(2);
    expect(stats.installed).toBe(1);
  });

  it('setBridge updates bridge reference', async () => {
    const bridge = { registerAgent: vi.fn().mockResolvedValue(undefined) };
    marketplace.register(createEntry({ id: 'a1' }));

    // Before setBridge, install should fail
    let result = await marketplace.install('a1');
    expect(result.success).toBe(false);

    marketplace.setBridge(bridge as any);
    result = await marketplace.install('a1');
    expect(result.success).toBe(true);
  });

  it('constructor accepts optional bridge', async () => {
    const bridge = { registerAgent: vi.fn().mockResolvedValue(undefined) };
    const mp = new AgentMarketplace(bridge as any);
    mp.register(createEntry({ id: 'a1' }));

    const result = await mp.install('a1');
    expect(result.success).toBe(true);
  });
});
