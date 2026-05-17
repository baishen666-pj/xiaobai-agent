import type { Tool, ToolResult } from '../tools/registry.js';
import type { HookEvent, HookResult } from '../hooks/system.js';
import type { LLMProvider, ProviderConfig } from '../provider/types.js';
import type { SandboxMode, NetworkMode } from '../sandbox/manager.js';

export type PluginPermission =
  | 'tools:register'
  | 'tools:execute'
  | 'hooks:subscribe'
  | 'providers:register'
  | 'config:read'
  | 'config:write'
  | 'memory:read'
  | 'memory:write';

export type PluginState =
  | 'discovered'
  | 'loaded'
  | 'initialized'
  | 'activated'
  | 'deactivated'
  | 'error';

export interface PluginSandboxConfig {
  mode: SandboxMode;
  network?: NetworkMode;
  allowedDomains?: string[];
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  minAppVersion?: string;
  permissions: PluginPermission[];
  sandbox?: PluginSandboxConfig;
  provides?: {
    tools?: string[];
    providers?: string[];
  };
}

export interface Plugin {
  manifest: PluginManifest;
  init?(api: PluginAPI): Promise<void>;
  activate?(): Promise<void>;
  deactivate?(): Promise<void>;
  destroy?(): Promise<void>;
}

export interface PluginAPI {
  readonly pluginName: string;
  readonly state: PluginState;

  tools: {
    register(tool: Tool): void;
    unregister(name: string): void;
    execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  };

  hooks: {
    on(event: HookEvent, listener: (data: Record<string, unknown>) => Promise<HookResult | void>): () => void;
  };

  providers: {
    register(name: string, factory: (config: ProviderConfig) => LLMProvider): void;
    unregister(name: string): void;
  };

  config: {
    get(): Record<string, unknown>;
    set(values: Record<string, unknown>): void;
  };

  memory: {
    add(content: string): void;
    list(): string[];
  };

  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

export interface PluginError {
  pluginName: string;
  phase: string;
  error: Error;
  timestamp: number;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  state: PluginState;
  author?: string;
}
