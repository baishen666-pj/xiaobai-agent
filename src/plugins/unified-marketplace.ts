import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MarketplaceRegistry, type MarketplaceEntry, type MarketplaceSearchOptions, type MarketplaceInstallResult } from './registry.js';
import { PluginMarketplace, type MarketplacePlugin } from './marketplace.js';

export interface UnifiedMarketplaceOptions {
  registryUrl?: string;
  localIndexDir?: string;
  pluginsDir?: string;
}

export class UnifiedMarketplace {
  private registry: MarketplaceRegistry;
  private fileMarket: PluginMarketplace;
  private registryUrl: string;
  private pluginsDir: string;
  private remoteFetched = false;

  constructor(options: UnifiedMarketplaceOptions = {}) {
    this.registry = new MarketplaceRegistry();
    this.fileMarket = new PluginMarketplace({
      registryUrl: options.registryUrl,
      localIndexDir: options.localIndexDir,
    });
    this.registryUrl = options.registryUrl ?? 'https://registry.xiaobai.dev/plugins';
    this.pluginsDir = options.pluginsDir ?? join(process.cwd(), '.xiaobai', 'plugins');
  }

  async search(query: string, options?: Omit<MarketplaceSearchOptions, 'query'>): Promise<MarketplaceEntry[]> {
    if (!this.remoteFetched) {
      await this.fetchRemoteRegistry();
    }
    return this.registry.search({ query, ...options });
  }

  async browse(category?: string): Promise<MarketplaceEntry[]> {
    if (!this.remoteFetched) {
      await this.fetchRemoteRegistry();
    }
    if (category) {
      return this.registry.search({ tags: [category] });
    }
    return this.registry.listAll();
  }

  async install(idOrSource: string): Promise<MarketplaceInstallResult> {
    const entry = this.registry.get(idOrSource);
    if (entry) {
      const result = await this.registry.install(idOrSource);
      if (result.success && entry.repository) {
        if (entry.repository.includes('github.com')) {
          const repo = entry.repository.replace('https://github.com/', '');
          await this.fileMarket.installFromGitHub(repo, this.pluginsDir);
        }
      }
      return result;
    }

    if (idOrSource.startsWith('github:')) {
      const r = await this.fileMarket.installFromGitHub(idOrSource, this.pluginsDir);
      return { success: r.success, error: r.error };
    }

    if (idOrSource.startsWith('npm:')) {
      const r = await this.fileMarket.installFromNpm(idOrSource, this.pluginsDir);
      return { success: r.success, error: r.error };
    }

    return { success: false, error: `Plugin "${idOrSource}" not found` };
  }

  async uninstall(name: string): Promise<MarketplaceInstallResult> {
    const entries = this.registry.listAll();
    const entry = entries.find(e => e.name === name);
    if (!entry) {
      return { success: false, error: `Plugin "${name}" not found` };
    }
    return this.registry.uninstall(entry.id);
  }

  getInstalled(): MarketplaceEntry[] {
    return this.registry.getInstalled();
  }

  getStats(): { total: number; installed: number; categories: Map<string, number> } {
    return this.registry.getStats();
  }

  registerEntry(entry: MarketplaceEntry): void {
    this.registry.register(entry);
  }

  formatList(entries: MarketplaceEntry[]): string {
    return this.registry.formatList(entries);
  }

  async fetchRemoteRegistry(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(this.registryUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) return;

      const data = await res.json() as { plugins?: Array<Record<string, unknown>> };
      if (data.plugins && Array.isArray(data.plugins)) {
        for (const raw of data.plugins) {
          const entry = this.rawToEntry(raw);
          if (entry) this.registry.register(entry);
        }
      }
      this.remoteFetched = true;
    } catch {
      // Remote registry unavailable, continue with local data
    }

    const localList = await this.fileMarket.list();
    for (const p of localList) {
      if (!this.registry.get(p.name)) {
        this.registry.register(this.pluginToEntry(p));
      }
    }
  }

  private rawToEntry(raw: Record<string, unknown>): MarketplaceEntry | null {
    if (!raw.name || typeof raw.name !== 'string') return null;
    return {
      id: String(raw.id ?? raw.name),
      name: String(raw.name),
      description: String(raw.description ?? ''),
      version: String(raw.version ?? '0.0.0'),
      author: String(raw.author ?? ''),
      repository: String(raw.repository ?? ''),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
      permissions: Array.isArray(raw.permissions) ? raw.permissions as MarketplaceEntry['permissions'] : [],
      rating: Number(raw.rating ?? 0),
      downloads: Number(raw.downloads ?? 0),
      verified: Boolean(raw.verified ?? false),
      manifest: raw.manifest as MarketplaceEntry['manifest'],
      publishedAt: String(raw.publishedAt ?? new Date().toISOString()),
      updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
    };
  }

  private pluginToEntry(p: MarketplacePlugin): MarketplaceEntry {
    return {
      id: p.name,
      name: p.name,
      description: p.description,
      version: p.version,
      author: p.author,
      repository: p.repository ?? p.sourcePath,
      tags: p.tags ?? [p.category],
      permissions: [],
      rating: p.rating ?? 0,
      downloads: p.downloads ?? 0,
      verified: false,
      manifest: {
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        permissions: [],
      },
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
