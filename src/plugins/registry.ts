import type { PluginManifest, PluginPermission } from './types.js';

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  repository: string;
  tags: string[];
  permissions: PluginPermission[];
  rating: number;
  downloads: number;
  verified: boolean;
  manifest: PluginManifest;
  publishedAt: string;
  updatedAt: string;
}

export interface MarketplaceSearchOptions {
  query?: string;
  tags?: string[];
  author?: string;
  sortBy?: 'rating' | 'downloads' | 'updated' | 'name';
  limit?: number;
  offset?: number;
}

export interface MarketplaceInstallResult {
  success: boolean;
  entry?: MarketplaceEntry;
  error?: string;
}

export class MarketplaceRegistry {
  private entries = new Map<string, MarketplaceEntry>();
  private installed = new Set<string>();

  register(entry: MarketplaceEntry): void {
    this.entries.set(entry.id, entry);
  }

  unregister(id: string): boolean {
    return this.entries.delete(id);
  }

  get(id: string): MarketplaceEntry | undefined {
    return this.entries.get(id);
  }

  search(options: MarketplaceSearchOptions = {}): MarketplaceEntry[] {
    let results = Array.from(this.entries.values());

    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    if (options.tags && options.tags.length > 0) {
      const tags = options.tags.map((t) => t.toLowerCase());
      results = results.filter((e) =>
        tags.some((t) => e.tags.some((et) => et.toLowerCase() === t)),
      );
    }

    if (options.author) {
      const a = options.author.toLowerCase();
      results = results.filter((e) => e.author.toLowerCase() === a);
    }

    switch (options.sortBy) {
      case 'rating':
        results.sort((a, b) => b.rating - a.rating);
        break;
      case 'downloads':
        results.sort((a, b) => b.downloads - a.downloads);
        break;
      case 'updated':
        results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
      case 'name':
        results.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  async install(id: string): Promise<MarketplaceInstallResult> {
    const entry = this.entries.get(id);
    if (!entry) {
      return { success: false, error: `Plugin "${id}" not found in marketplace` };
    }

    if (this.installed.has(id)) {
      return { success: false, error: `Plugin "${id}" is already installed` };
    }

    this.installed.add(id);
    return { success: true, entry };
  }

  async uninstall(id: string): Promise<MarketplaceInstallResult> {
    if (!this.installed.has(id)) {
      return { success: false, error: `Plugin "${id}" is not installed` };
    }

    this.installed.delete(id);
    const entry = this.entries.get(id);
    return { success: true, entry };
  }

  isInstalled(id: string): boolean {
    return this.installed.has(id);
  }

  getInstalled(): MarketplaceEntry[] {
    return Array.from(this.installed)
      .map((id) => this.entries.get(id))
      .filter((e): e is MarketplaceEntry => e !== undefined);
  }

  listAll(): MarketplaceEntry[] {
    return Array.from(this.entries.values());
  }

  getStats(): { total: number; installed: number; categories: Map<string, number> } {
    const categories = new Map<string, number>();
    for (const entry of this.entries.values()) {
      for (const tag of entry.tags) {
        categories.set(tag, (categories.get(tag) ?? 0) + 1);
      }
    }
    return { total: this.entries.size, installed: this.installed.size, categories };
  }

  formatList(entries: MarketplaceEntry[]): string {
    if (entries.length === 0) return 'No plugins found.';

    const lines: string[] = [];
    for (const e of entries) {
      const installed = this.installed.has(e.id) ? ' [installed]' : '';
      const verified = e.verified ? ' ✓' : '';
      const stars = e.rating > 0 ? ` (${e.rating.toFixed(1)}★)` : '';
      lines.push(`  ${e.name} v${e.version}${verified}${stars}${installed}`);
      lines.push(`    ${e.description}`);
      if (e.tags.length > 0) lines.push(`    Tags: ${e.tags.join(', ')}`);
    }
    return lines.join('\n');
  }
}