import type { Tool } from '../tools/registry.js';
import type { HookEvent, HookResult } from '../hooks/system.js';
import type { LLMProvider, ProviderConfig } from '../provider/types.js';
import type { PluginAPI, PluginError, PluginManifest, PluginState } from './types.js';
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
      const unsubscribe = this._hookSystem.on(event, listener);
      this._cleanupFns.push(unsubscribe);
      return unsubscribe;
    },
  };

  readonly providers: PluginAPI['providers'] = {
    register: (name: string, factory: (config: ProviderConfig) => LLMProvider): void => {
      try {
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
        const cfg = this._configManager.get() as unknown as Record<string, Record<string, unknown>>;
        const plugins = cfg.plugins;
        const scoped = plugins && typeof plugins === 'object' ? plugins[this.pluginName] : undefined;
        return scoped as Record<string, unknown> | undefined ?? Object.create(null);
      } catch {
        return {};
      }
    },

    set: (values: Record<string, unknown>): void => {
      try {
        const cfg = this._configManager.get() as unknown as Record<string, Record<string, Record<string, unknown>>>;
        const plugins = cfg.plugins ?? {};
        plugins[this.pluginName] = { ...(plugins[this.pluginName] ?? {}), ...values };
        this._configManager.save({ plugins } as any);
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
