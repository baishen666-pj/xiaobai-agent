import type { Tool } from '../tools/registry.js';
import type { HookEvent, HookResult } from '../hooks/system.js';
import type { LLMProvider, ProviderConfig } from '../provider/types.js';
import type { PluginAPI, PluginError, PluginManifest, PluginPermission, PluginState } from './types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { HookSystem } from '../hooks/system.js';
import type { ProviderRouter } from '../provider/router.js';
import type { ConfigManager } from '../config/manager.js';
import type { MemorySystem } from '../memory/system.js';

type ErrorCb = (error: PluginError) => void;

export class PluginAPIImpl implements PluginAPI {
  private _state: PluginState = 'discovered';
  private _toolNames = new Map<string, string>();
  private _cleanupFns: (() => void)[] = [];
  private _toolRegistry: ToolRegistry;
  private _hookSystem: HookSystem;
  private _configManager: ConfigManager;
  private _memorySystem: MemorySystem;
  private _providerRouter: ProviderRouter;
  private _onError: ErrorCb;

  constructor(
    public readonly pluginName: string,
    private manifest: PluginManifest,
    toolRegistry: ToolRegistry,
    hookSystem: HookSystem,
    configManager: ConfigManager,
    memorySystem: MemorySystem,
    providerRouter: ProviderRouter,
    onError: ErrorCb,
  ) {
    this._toolRegistry = toolRegistry;
    this._hookSystem = hookSystem;
    this._configManager = configManager;
    this._memorySystem = memorySystem;
    this._providerRouter = providerRouter;
    this._onError = onError;
  }

  private checkPermission(perm: PluginPermission): void {
    if (!this.manifest.permissions.includes(perm)) {
      throw new Error(`Plugin "${this.pluginName}" lacks permission: ${perm}. Declared: [${this.manifest.permissions.join(', ')}]`);
    }
  }

  get state(): PluginState {
    return this._state;
  }

  setState(state: PluginState): void {
    this._state = state;
  }

  getCleanupFns(): (() => void)[] {
    return this._cleanupFns;
  }

  readonly tools: PluginAPI['tools'] = {
    register: (tool: Tool): void => {
      try {
        this.checkPermission('tools:register');
        const internalName = `${this.pluginName}:${tool.definition.name}`;
        this._toolNames.set(tool.definition.name, internalName);
        this._toolRegistry.register({
          ...tool,
          definition: { ...tool.definition, name: internalName },
        });
      } catch (err) {
        this._onError({
          pluginName: this.pluginName,
          phase: 'tools.register',
          error: err instanceof Error ? err : new Error(String(err)),
          timestamp: Date.now(),
        });
      }
    },

    unregister: (name: string): void => {
      try {
        this.checkPermission('tools:register');
        const internalName = this._toolNames.get(name);
        if (internalName) {
          this._toolRegistry.unregister(internalName);
          this._toolNames.delete(name);
        }
      } catch (err) {
        this._onError({
          pluginName: this.pluginName,
          phase: 'tools.unregister',
          error: err instanceof Error ? err : new Error(String(err)),
          timestamp: Date.now(),
        });
      }
    },
  };

  readonly hooks: PluginAPI['hooks'] = {
    on: (event: HookEvent, listener: (data: Record<string, unknown>) => Promise<HookResult | void>): (() => void) => {
      this.checkPermission('hooks:subscribe');
      const unsubscribe = this._hookSystem.on(event, listener);
      this._cleanupFns.push(unsubscribe);
      return unsubscribe;
    },
  };

  readonly providers: PluginAPI['providers'] = {
    register: (name: string, factory: (config: ProviderConfig) => LLMProvider): void => {
      try {
        this.checkPermission('providers:register');
        this._providerRouter.registerProviderFactory(name, factory);
      } catch (err) {
        this._onError({
          pluginName: this.pluginName,
          phase: 'providers.register',
          error: err instanceof Error ? err : new Error(String(err)),
          timestamp: Date.now(),
        });
      }
    },

    unregister: (name: string): void => {
      try {
        this.checkPermission('providers:register');
        this._providerRouter.unregisterProviderFactory(name);
      } catch (err) {
        this._onError({
          pluginName: this.pluginName,
          phase: 'providers.unregister',
          error: err instanceof Error ? err : new Error(String(err)),
          timestamp: Date.now(),
        });
      }
    },
  };

  readonly config: PluginAPI['config'] = {
    get: (): Record<string, unknown> => {
      try {
        this.checkPermission('config:read');
        const cfg = this._configManager.get();
        const pluginConfig = (cfg.plugins?.config ?? {}) as Record<string, Record<string, unknown>>;
        return pluginConfig[this.pluginName] ?? {};
      } catch {
        return {};
      }
    },

    set: (values: Record<string, unknown>): void => {
      try {
        this.checkPermission('config:write');
        const cfg = this._configManager.get();
        const pluginConfig = (cfg.plugins?.config ?? {}) as Record<string, Record<string, unknown>>;
        pluginConfig[this.pluginName] = { ...(pluginConfig[this.pluginName] ?? {}), ...values };
        this._configManager.save({ plugins: { ...cfg.plugins, config: pluginConfig } } as Partial<import('../config/manager.js').XiaobaiConfig>);
      } catch (err) {
        this._onError({
          pluginName: this.pluginName,
          phase: 'config.set',
          error: err instanceof Error ? err : new Error(String(err)),
          timestamp: Date.now(),
        });
      }
    },
  };

  readonly memory: PluginAPI['memory'] = {
    add: (content: string): void => {
      try {
        this.checkPermission('memory:write');
        this._memorySystem.add('memory', content);
      } catch (err) {
        this._onError({
          pluginName: this.pluginName,
          phase: 'memory.add',
          error: err instanceof Error ? err : new Error(String(err)),
          timestamp: Date.now(),
        });
      }
    },

    list: (): string[] => {
      try {
        this.checkPermission('memory:read');
        return this._memorySystem.list('memory');
      } catch {
        return [];
      }
    },
  };

  readonly logger: PluginAPI['logger'] = {
    info: (msg: string): void => {
      console.error(`[plugin:${this.pluginName}] ${msg}`);
    },
    warn: (msg: string): void => {
      console.error(`[plugin:${this.pluginName}] WARN: ${msg}`);
    },
    error: (msg: string): void => {
      console.error(`[plugin:${this.pluginName}] ERROR: ${msg}`);
    },
  };
}
