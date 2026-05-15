import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface XiaobaiConfig {
  model: {
    default: string;
    fallback?: string;
    vision?: string;
    compact?: string;
  };
  provider: {
    default: string;
    apiKey?: string;
    baseUrl?: string;
    fallbacks?: ProviderConfig[];
  };
  memory: {
    enabled: boolean;
    memoryCharLimit: number;
    userCharLimit: number;
    externalProviders?: ExternalMemoryProvider[];
  };
  skills: {
    enabled: boolean;
    hubSources?: string[];
  };
  sandbox: {
    mode: 'read-only' | 'workspace-write' | 'full-access';
  };
  hooks: Record<string, HookConfig[]>;
  context: {
    compressionThreshold: number;
    maxTurns: number;
    keepLastN: number;
  };
  permissions: {
    mode: 'default' | 'auto' | 'plan' | 'accept-edits';
    deny: string[];
    allow: string[];
  };
}

export interface ProviderConfig {
  name: string;
  apiKey?: string;
  baseUrl: string;
  apiMode: 'chat-completions' | 'responses' | 'anthropic';
}

export interface ExternalMemoryProvider {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface HookConfig {
  event: string;
  command?: string;
  type: 'command' | 'http' | 'prompt' | 'mcp_tool';
  url?: string;
  async?: boolean;
}

const DEFAULT_CONFIG: XiaobaiConfig = {
  model: {
    default: 'claude-sonnet-4-6',
    fallback: 'claude-haiku-4-5-20251001',
    compact: 'claude-haiku-4-5-20251001',
  },
  provider: {
    default: 'anthropic',
  },
  memory: {
    enabled: true,
    memoryCharLimit: 2200,
    userCharLimit: 1375,
  },
  skills: {
    enabled: true,
    hubSources: ['official', 'github'],
  },
  sandbox: {
    mode: 'workspace-write',
  },
  hooks: {},
  context: {
    compressionThreshold: 0.5,
    maxTurns: 90,
    keepLastN: 20,
  },
  permissions: {
    mode: 'default',
    deny: [],
    allow: [],
  },
};

export class ConfigManager {
  private config: XiaobaiConfig;
  private configDir: string;

  constructor(profile?: string) {
    this.configDir = join(homedir(), '.xiaobai', profile ?? 'default');
    this.config = this.load();
  }

  private load(): XiaobaiConfig {
    const configPath = join(this.configDir, 'config.yaml');
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      const userConfig = parseYaml(raw) as Partial<XiaobaiConfig>;
      return this.mergeConfig(DEFAULT_CONFIG, userConfig);
    }

    const envConfig = this.loadFromEnv();
    if (Object.keys(envConfig).length > 0) {
      return this.mergeConfig(DEFAULT_CONFIG, envConfig);
    }

    return { ...DEFAULT_CONFIG };
  }

  private loadFromEnv(): Partial<XiaobaiConfig> {
    const config: Partial<XiaobaiConfig> = {};
    const apiKey = process.env['XIAOBAI_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'] ?? process.env['OPENAI_API_KEY'];
    if (apiKey) {
      config.provider = { default: 'anthropic', apiKey };
    }
    const model = process.env['XIAOBAI_MODEL'];
    if (model) {
      config.model = { ...config.model, default: model } as XiaobaiConfig['model'];
    }
    return config;
  }

  private mergeConfig(base: XiaobaiConfig, override: Partial<XiaobaiConfig>): XiaobaiConfig {
    return {
      ...base,
      ...override,
      model: { ...base.model, ...override.model },
      provider: { ...base.provider, ...override.provider },
      memory: { ...base.memory, ...override.memory },
      skills: { ...base.skills, ...override.skills },
      sandbox: { ...base.sandbox, ...override.sandbox },
      context: { ...base.context, ...override.context },
      permissions: { ...base.permissions, ...override.permissions },
    };
  }

  get(): XiaobaiConfig;
  get<K extends keyof XiaobaiConfig>(key: K): XiaobaiConfig[K];
  get(key?: keyof XiaobaiConfig): XiaobaiConfig | XiaobaiConfig[keyof XiaobaiConfig] {
    if (key !== undefined) return this.config[key];
    return this.config;
  }

  save(config: Partial<XiaobaiConfig>): void {
    this.config = this.mergeConfig(this.config, config);
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    writeFileSync(
      join(this.configDir, 'config.yaml'),
      stringifyYaml(this.config),
      'utf-8',
    );
  }

  getConfigDir(): string {
    return this.configDir;
  }

  static getDefault(): XiaobaiConfig {
    return { ...DEFAULT_CONFIG };
  }
}
