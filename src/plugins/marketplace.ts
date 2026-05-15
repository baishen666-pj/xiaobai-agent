export interface MarketplacePlugin {
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  sourcePath: string;
  homepage?: string;
  repository?: string;
  tags?: string[];
  downloads?: number;
  rating?: number;
}

export interface MarketplaceManifest {
  version: string;
  updatedAt: string;
  plugins: MarketplacePlugin[];
}

export class PluginMarketplace {
  private registryUrl: string;
  private cache: MarketplaceManifest | null = null;
  private cacheExpiry = 0;
  private cacheTtl = 3600_000; // 1 hour

  constructor(registryUrl?: string) {
    this.registryUrl = registryUrl ?? 'https://xiaobai.dev/api/plugins';
  }

  async list(query?: string): Promise<MarketplacePlugin[]> {
    const manifest = await this.fetchManifest();
    if (!query) return manifest.plugins;

    const lower = query.toLowerCase();
    return manifest.plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower) ||
        p.tags?.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  async search(query: string): Promise<MarketplacePlugin[]> {
    return this.list(query);
  }

  async getByName(name: string): Promise<MarketplacePlugin | undefined> {
    const manifest = await this.fetchManifest();
    return manifest.plugins.find((p) => p.name === name);
  }

  async listByCategory(category: string): Promise<MarketplacePlugin[]> {
    const manifest = await this.fetchManifest();
    return manifest.plugins.filter((p) => p.category === category);
  }

  private async fetchManifest(): Promise<MarketplaceManifest> {
    if (this.cache && Date.now() < this.cacheExpiry) return this.cache;

    try {
      const response = await fetch(`${this.registryUrl}/manifest.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = (await response.json()) as MarketplaceManifest;
      this.cache = manifest;
      this.cacheExpiry = Date.now() + this.cacheTtl;
      return manifest;
    } catch {
      return this.cache ?? { version: '0', updatedAt: '', plugins: [] };
    }
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
  }
}
