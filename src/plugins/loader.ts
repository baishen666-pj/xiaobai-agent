import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Plugin, PluginManifest, PluginState } from './types.js';

const ManifestSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9-]*$/, 'Plugin name must be lowercase-hyphen, starting with a letter'),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Version must be semver (x.y.z)'),
  description: z.string().min(1),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
  minAppVersion: z.string().optional(),
  permissions: z.array(z.enum([
    'tools:register', 'tools:execute',
    'hooks:subscribe',
    'providers:register',
    'config:read', 'config:write',
    'memory:read', 'memory:write',
  ])).default([]),
  provides: z.object({
    tools: z.array(z.string()).optional(),
    providers: z.array(z.string()).optional(),
  }).optional(),
});

export interface DiscoveredPlugin {
  dir: string;
  manifest: PluginManifest;
  state: PluginState;
}

export function discoverPlugins(pluginsDir: string): DiscoveredPlugin[] {
  if (!existsSync(pluginsDir)) return [];

  const results: DiscoveredPlugin[] = [];
  const entries = readdirSync(pluginsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    const manifestPath = join(pluginsDir, entry.name, 'plugin.json');
    if (!existsSync(manifestPath)) continue;

    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const manifest = validateManifest(raw);
      results.push({ dir: join(pluginsDir, entry.name), manifest, state: 'discovered' });
    } catch {
      // Invalid manifest, skip
    }
  }

  return results;
}

export function validateManifest(raw: unknown): PluginManifest {
  return ManifestSchema.parse(raw) as PluginManifest;
}

export async function loadPluginModule(discovered: DiscoveredPlugin): Promise<Plugin> {
  const indexPath = join(discovered.dir, 'index.js');
  if (!existsSync(indexPath)) {
    throw new Error(`Plugin ${discovered.manifest.name}: no index.js found in ${discovered.dir}`);
  }

  const moduleUrl = pathToFileURL(indexPath).href;
  const module = await import(moduleUrl);

  if (!module || typeof module !== 'object') {
    throw new Error(`Plugin ${discovered.manifest.name}: module did not export an object`);
  }

  const plugin = (module.default ?? module) as Record<string, unknown>;

  if (!plugin.manifest || typeof plugin.manifest !== 'object') {
    throw new Error(`Plugin ${discovered.manifest.name}: missing or invalid manifest export`);
  }

  return {
    manifest: discovered.manifest,
    init: typeof plugin.init === 'function' ? plugin.init.bind(plugin) : undefined,
    activate: typeof plugin.activate === 'function' ? plugin.activate.bind(plugin) : undefined,
    deactivate: typeof plugin.deactivate === 'function' ? plugin.deactivate.bind(plugin) : undefined,
    destroy: typeof plugin.destroy === 'function' ? plugin.destroy.bind(plugin) : undefined,
  };
}
