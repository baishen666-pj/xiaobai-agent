import * as fs from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { Plugin, PluginError, PluginInfo, PluginState } from './types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { HookSystem } from '../hooks/system.js';
import type { ConfigManager } from '../config/manager.js';
import type { MemorySystem } from '../memory/system.js';
import type { ProviderRouter } from '../provider/router.js';
import type { SandboxManager } from '../sandbox/manager.js';
import { PluginAPIImpl } from './api.js';
import { discoverPlugins, loadPluginModule } from './loader.js';

const fsp = fs.promises;
const exists = (p: string) => fsp.access(p).then(() => true, () => false);

interface PluginHandle {
  plugin: Plugin;
  api: PluginAPIImpl;
  state: PluginState;
  dir: string;
}

const APP_VERSION = '0.7.0';

function satisfiesMinVersion(minVersion: string, appVersion: string): boolean {
  const parseVer = (v: string) => v.split('.').map(Number);
  const min = parseVer(minVersion);
  const app = parseVer(appVersion);
  for (let i = 0; i < 3; i++) {
    if ((app[i] ?? 0) < (min[i] ?? 0)) return false;
    if ((app[i] ?? 0) > (min[i] ?? 0)) return true;
  }
  return true;
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
  private sandbox?: SandboxManager;
  private watcher?: fs.FSWatcher;
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(deps: {
    tools: ToolRegistry;
    hooks: HookSystem;
    config: ConfigManager;
    memory: MemorySystem;
    providers: ProviderRouter;
    pluginsDir?: string;
    sandbox?: SandboxManager;
  }) {
    this.deps = deps;
    this.sandbox = deps.sandbox;
    this.pluginsDir = deps.pluginsDir ?? join(homedir(), '.xiaobai', 'default', 'plugins');
  }

  async init(): Promise<void> {
    const discovered = discoverPlugins(this.pluginsDir);

    for (const entry of discovered) {
      try {
        if (entry.manifest.minAppVersion && !satisfiesMinVersion(entry.manifest.minAppVersion, APP_VERSION)) {
          this.errors.push({
            pluginName: entry.manifest.name,
            phase: 'load',
            error: new Error(`Plugin requires >=${entry.manifest.minAppVersion}, but app is ${APP_VERSION}`),
            timestamp: Date.now(),
          });
          continue;
        }

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
          this.sandbox,
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
    if (!(await exists(source))) {
      throw new Error(`Source path does not exist: ${source}`);
    }

    const name = basename(source);
    const dest = join(this.pluginsDir, name);

    if (await exists(dest)) {
      throw new Error(`Plugin "${name}" already exists at ${dest}`);
    }

    await fsp.mkdir(this.pluginsDir, { recursive: true });
    await fsp.cp(source, dest, { recursive: true });
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

    if (await exists(handle.dir)) {
      await fsp.rm(handle.dir, { recursive: true, force: true });
    }

    this.plugins.delete(name);
  }

  startWatching(): void {
    if (this.watcher) return;
    if (!fs.existsSync(this.pluginsDir)) return;

    this.watcher = fs.watch(this.pluginsDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const pluginName = filename.split(/[/\\]/)[0];
      if (!pluginName) return;

      const existing = this.debounceTimers.get(pluginName);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(pluginName, setTimeout(() => {
        this.debounceTimers.delete(pluginName);
        void this.reloadPlugin(pluginName);
      }, 300));
    });
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private async reloadPlugin(name: string): Promise<void> {
    const handle = this.plugins.get(name);
    if (!handle) return;

    const wasActivated = handle.state === 'activated';
    if (wasActivated) {
      await this.deactivate(name);
    }

    const pluginDir = handle.dir;
    this.plugins.delete(name);

    const discovered = discoverPlugins(this.pluginsDir).filter(d => d.manifest.name === name);
    if (discovered.length === 0) return;

    try {
      const plugin = await loadPluginModule(discovered[0]);
      const api = new PluginAPIImpl(
        discovered[0].manifest.name,
        discovered[0].manifest,
        this.deps.tools,
        this.deps.hooks,
        this.deps.config,
        this.deps.memory,
        this.deps.providers,
        (err) => this.errors.push(err),
        this.sandbox,
      );

      api.setState('loaded');

      if (plugin.init) await plugin.init(api);
      api.setState('initialized');

      this.plugins.set(name, { plugin, api, state: api.state, dir: pluginDir });

      if (wasActivated) {
        await this.activate(name);
      }
    } catch (err) {
      this.errors.push({
        pluginName: name,
        phase: 'reload',
        error: err instanceof Error ? err : new Error(String(err)),
        timestamp: Date.now(),
      });
    }
  }
}
