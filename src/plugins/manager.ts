import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { Plugin, PluginError, PluginInfo, PluginState } from './types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { HookSystem } from '../hooks/system.js';
import type { ConfigManager } from '../config/manager.js';
import type { MemorySystem } from '../memory/system.js';
import type { ProviderRouter } from '../provider/router.js';
import { PluginAPIImpl } from './api.js';
import { discoverPlugins, loadPluginModule } from './loader.js';

interface PluginHandle {
  plugin: Plugin;
  api: PluginAPIImpl;
  state: PluginState;
  dir: string;
}

export class PluginManager {
  private plugins = new Map<string, PluginHandle>();
  private pluginsDir: string;
  private errors: PluginError[] = [];
  private deps: {
    tools: ToolRegistry;
    hooks: HookSystem;
    config: ConfigManager;
    memory: MemorySystem;
    providers: ProviderRouter;
  };

  constructor(deps: {
    tools: ToolRegistry;
    hooks: HookSystem;
    config: ConfigManager;
    memory: MemorySystem;
    providers: ProviderRouter;
    pluginsDir?: string;
  }) {
    this.deps = deps;
    this.pluginsDir = deps.pluginsDir ?? join(homedir(), '.xiaobai', 'default', 'plugins');
  }

  async init(): Promise<void> {
    const discovered = discoverPlugins(this.pluginsDir);

    for (const entry of discovered) {
      try {
        const plugin = await loadPluginModule(entry);
        const api = new PluginAPIImpl(
          entry.manifest.name,
          entry.manifest,
          this.deps.tools,
          this.deps.hooks,
          this.deps.config,
          this.deps.memory,
          this.deps.providers,
          (err) => this.errors.push(err),
        );

        api.setState('loaded');

        if (plugin.init) {
          try {
            await plugin.init(api);
            api.setState('initialized');
          } catch (err) {
            api.setState('error');
            this.errors.push({
              pluginName: entry.manifest.name,
              phase: 'init',
              error: err instanceof Error ? err : new Error(String(err)),
              timestamp: Date.now(),
            });
          }
        } else {
          api.setState('initialized');
        }

        this.plugins.set(entry.manifest.name, { plugin, api, state: api.state, dir: entry.dir });
      } catch (err) {
        this.errors.push({
          pluginName: entry.manifest.name,
          phase: 'load',
          error: err instanceof Error ? err : new Error(String(err)),
          timestamp: Date.now(),
        });
      }
    }
  }

  async activateAll(): Promise<void> {
    for (const [name, handle] of this.plugins) {
      if (handle.state === 'initialized') {
        await this.activate(name);
      }
    }
  }

  async deactivateAll(): Promise<void> {
    for (const [name, handle] of this.plugins) {
      if (handle.state === 'activated') {
        await this.deactivate(name);
      }
    }
  }

  async activate(name: string): Promise<void> {
    const handle = this.plugins.get(name);
    if (!handle || handle.state !== 'initialized') return;

    try {
      if (handle.plugin.activate) {
        await handle.plugin.activate();
      }
      handle.api.setState('activated');
      handle.state = 'activated';
    } catch (err) {
      handle.api.setState('error');
      handle.state = 'error';
      this.errors.push({
        pluginName: name,
        phase: 'activate',
        error: err instanceof Error ? err : new Error(String(err)),
        timestamp: Date.now(),
      });
    }
  }

  async deactivate(name: string): Promise<void> {
    const handle = this.plugins.get(name);
    if (!handle || handle.state !== 'activated') return;

    try {
      if (handle.plugin.deactivate) {
        await handle.plugin.deactivate();
      }
    } catch {
      // Best-effort deactivate
    }

    for (const cleanup of handle.api.getCleanupFns()) {
      try { cleanup(); } catch { /* ignore */ }
    }
    handle.api.getCleanupFns().length = 0;

    handle.api.setState('deactivated');
    handle.state = 'deactivated';
  }

  list(): PluginInfo[] {
    return Array.from(this.plugins.entries()).map(([name, handle]) => ({
      name,
      version: handle.plugin.manifest.version,
      description: handle.plugin.manifest.description,
      state: handle.state,
      author: handle.plugin.manifest.author,
    }));
  }

  get(name: string): PluginHandle | undefined {
    return this.plugins.get(name);
  }

  getErrors(): PluginError[] {
    return [...this.errors];
  }

  async install(source: string): Promise<void> {
    if (!existsSync(source)) {
      throw new Error(`Source path does not exist: ${source}`);
    }

    const name = basename(source);
    const dest = join(this.pluginsDir, name);

    if (existsSync(dest)) {
      throw new Error(`Plugin "${name}" already exists at ${dest}`);
    }

    mkdirSync(this.pluginsDir, { recursive: true });
    cpSync(source, dest, { recursive: true });
  }

  async uninstall(name: string): Promise<void> {
    const handle = this.plugins.get(name);
    if (!handle) return;

    if (handle.state === 'activated') {
      await this.deactivate(name);
    }

    try {
      if (handle.plugin.destroy) {
        await handle.plugin.destroy();
      }
    } catch {
      // Best-effort destroy
    }

    if (existsSync(handle.dir)) {
      rmSync(handle.dir, { recursive: true, force: true });
    }

    this.plugins.delete(name);
  }
}
