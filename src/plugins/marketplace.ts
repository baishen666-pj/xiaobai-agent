import { execSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  private localIndexDir: string;
  private cache: MarketplaceManifest | null = null;
  private cacheExpiry = 0;
  private cacheTtl = 3600_000;

  constructor(options?: { registryUrl?: string; localIndexDir?: string }) {
    this.registryUrl = options?.registryUrl ?? 'https://registry.npmjs.org';
    this.localIndexDir = options?.localIndexDir ?? join(process.cwd(), '.xiaobai', 'plugin-index');
  }

  async list(query?: string): Promise<MarketplacePlugin[]> {
    const manifest = await this.getLocalIndex();
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
    const manifest = await this.getLocalIndex();
    return manifest.plugins.find((p) => p.name === name);
  }

  async listByCategory(category: string): Promise<MarketplacePlugin[]> {
    const manifest = await this.getLocalIndex();
    return manifest.plugins.filter((p) => p.category === category);
  }

  async installFromGitHub(repo: string, targetDir: string): Promise<{ success: boolean; error?: string }> {
    const [owner, repoName] = repo.replace(/^github:/, '').split('/');
    if (!owner || !repoName) return { success: false, error: 'Invalid format. Use: github:owner/repo' };
    if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repoName)) {
      return { success: false, error: 'Invalid owner or repo name characters' };
    }

    const dest = join(targetDir, repoName);
    if (existsSync(dest)) return { success: false, error: `Plugin already exists: ${repoName}` };

    try {
      execFileSync('git', ['clone', '--depth', '1', `https://github.com/${owner}/${repoName}.git`, dest], {
        stdio: 'pipe',
        timeout: 60_000,
      });
      this.addToLocalIndex({
        name: repoName,
        description: `Installed from github:${owner}/${repoName}`,
        author: owner,
        version: '0.0.0',
        category: 'installed',
        sourcePath: dest,
        repository: `https://github.com/${owner}/${repoName}`,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: `Clone failed: ${(err as Error).message}` };
    }
  }

  async installFromNpm(packageName: string, targetDir: string): Promise<{ success: boolean; error?: string }> {
    const name = packageName.replace(/^npm:/, '');
    if (!/^[a-zA-Z0-9@._\/-]+$/.test(name)) {
      return { success: false, error: 'Invalid package name characters' };
    }
    const dest = join(targetDir, name.replace(/[\/@]/g, '_'));

    try {
      mkdirSync(dest, { recursive: true });
      execFileSync('npm', ['pack', name, '--pack-destination', dest], { stdio: 'pipe', timeout: 60_000 });

      const files = readdirSync(dest).filter((f) => f.endsWith('.tgz'));
      if (files.length > 0) {
        execFileSync('tar', ['-xzf', join(dest, files[0]), '-C', dest], { stdio: 'pipe' });
      }

      this.addToLocalIndex({
        name,
        description: `Installed from npm:${name}`,
        author: 'npm',
        version: '0.0.0',
        category: 'installed',
        sourcePath: dest,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: `npm install failed: ${(err as Error).message}` };
    }
  }

  private addToLocalIndex(plugin: MarketplacePlugin): void {
    const manifest = this.getLocalIndexSync();
    const existing = manifest.plugins.findIndex((p) => p.name === plugin.name);
    if (existing >= 0) {
      manifest.plugins[existing] = plugin;
    } else {
      manifest.plugins.push(plugin);
    }
    this.saveLocalIndex(manifest);
  }

  private async getLocalIndex(): Promise<MarketplaceManifest> {
    if (this.cache && Date.now() < this.cacheExpiry) return this.cache;
    const manifest = this.getLocalIndexSync();
    this.cache = manifest;
    this.cacheExpiry = Date.now() + this.cacheTtl;
    return manifest;
  }

  private getLocalIndexSync(): MarketplaceManifest {
    const indexPath = join(this.localIndexDir, 'index.json');
    if (!existsSync(indexPath)) {
      return { version: '1', updatedAt: new Date().toISOString(), plugins: [] };
    }
    try {
      return JSON.parse(readFileSync(indexPath, 'utf-8')) as MarketplaceManifest;
    } catch (e) {
      console.debug('marketplace: failed to parse local index, returning empty', (e as Error).message);
      return { version: '1', updatedAt: new Date().toISOString(), plugins: [] };
    }
  }

  private saveLocalIndex(manifest: MarketplaceManifest): void {
    if (!existsSync(this.localIndexDir)) {
      mkdirSync(this.localIndexDir, { recursive: true });
    }
    manifest.updatedAt = new Date().toISOString();
    writeFileSync(
      join(this.localIndexDir, 'index.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
    this.cache = null;
    this.cacheExpiry = 0;
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheExpiry = 0;
  }
}
