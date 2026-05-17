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
    network?: 'allow-all' | 'deny-all' | 'allow-list';
    allowedDomains?: string[];
    blockedCommands?: string[];
    maxExecutionTimeMs?: number;
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
  plugins: {
    enabled: boolean;
    config?: Record<string, Record<string, unknown>>;
  };
  auxiliary?: {
    architectProvider?: string;
    architectModel?: string;
    editorProvider?: string;
    editorModel?: string;
    reviewerProvider?: string;
    reviewerModel?: string;
    compactProvider?: string;
    compactModel?: string;
  };
  telemetry?: {
    enabled?: boolean;
    maxTraces?: number;
    sampleRate?: number;
  };
  persistence?: {
    enabled?: boolean;
    adapter?: 'json' | 'sqlite' | 'memory';
    path?: string;
  };
  server?: {
    sseEnabled?: boolean;
    heartbeatIntervalMs?: number;
  };
  apiGateway?: {
    enabled?: boolean;
    cors?: {
      origins?: string[];
    };
    rateLimit?: {
      windowMs?: number;
      maxRequests?: number;
    };
  };
  protocols?: {
    a2a?: {
      enabled?: boolean;
      port?: number;
      auth?: Record<string, string>;
    };
    acp?: {
      enabled?: boolean;
      port?: number;
    };
  };
  locale?: string;
}

export interface ProviderConfig {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  apiMode: 'chat-completions' | 'responses' | 'anthropic' | 'google';
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
  plugins: {
    enabled: true,
  },
  telemetry: {
    enabled: false,
    maxTraces: 100,
    sampleRate: 1.0,
  },
  persistence: {
    enabled: false,
    adapter: 'memory',
  },
  server: {
    sseEnabled: false,
    heartbeatIntervalMs: 30000,
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
    let config = { ...DEFAULT_CONFIG };

    // 1. Load from config.yaml if exists
    const configPath = join(this.configDir, 'config.yaml');
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      const userConfig = parseYaml(raw) as Partial<XiaobaiConfig>;
      config = this.mergeConfig(config, userConfig);
    }

    // 2. Environment variables always override file config
    const envConfig = this.loadFromEnv();
    if (Object.keys(envConfig).length > 0) {
      config = this.mergeConfig(config, envConfig);
    }

    return config;
  }

  private loadFromEnv(): Partial<XiaobaiConfig> {
    const config: Partial<XiaobaiConfig> = {};

    // Read XIAOBAI_PROVIDER to override default provider
    const providerName = process.env['XIAOBAI_PROVIDER'];
    if (providerName) {
      const apiKey = this.findApiKeyForProvider(providerName);
      config.provider = { default: providerName, ...(apiKey ? { apiKey } : {}) };
      // Set sensible model defaults for non-Anthropic providers
      if (!process.env['XIAOBAI_MODEL']) {
        const modelDefault = this.getDefaultModelForProvider(providerName);
        if (modelDefault) {
          config.model = { default: modelDefault, fallback: modelDefault, compact: modelDefault };
        }
      }
    } else {
      const apiKey = process.env['XIAOBAI_API_KEY'] ?? process.env['ANTHROPIC_API_KEY'] ?? process.env['OPENAI_API_KEY'];
      if (apiKey) {
        config.provider = { default: 'anthropic', apiKey };
      }
    }

    const model = process.env['XIAOBAI_MODEL'];
    if (model) {
      config.model = { ...config.model, default: model } as XiaobaiConfig['model'];
    }
    return config;
  }

  private findApiKeyForProvider(provider: string): string | undefined {
    const envMap: Record<string, string[]> = {
      anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
      openai: ['OPENAI_API_KEY'],
      google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      groq: ['GROQ_API_KEY'],
      deepseek: ['DEEPSEEK_API_KEY'],
      zhipu: ['ZHIPU_API_KEY'],
      qwen: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
      moonshot: ['MOONSHOT_API_KEY'],
      yi: ['YI_API_KEY'],
      baidu: ['BAIDU_API_KEY'],
      minimax: ['MINIMAX_API_KEY'],
      baichuan: ['BAICHU_API_KEY'],
    };
    const keys = envMap[provider] ?? [];
    for (const key of keys) {
      if (process.env[key]) return process.env[key];
    }
    return process.env['XIAOBAI_API_KEY'];
  }

  private getDefaultModelForProvider(provider: string): string | undefined {
    const modelMap: Record<string, string> = {
      deepseek: 'deepseek-chat',
      zhipu: 'glm-4-flash',
      qwen: 'qwen-turbo',
      moonshot: 'moonshot-v1-8k',
      yi: 'yi-lightning',
      baidu: 'ernie-4.0-8k',
      minimax: 'MiniMax-Text-01',
      baichuan: 'Baichuan4',
      openai: 'gpt-4o-mini',
      google: 'gemini-2.0-flash',
      groq: 'llama-3.3-70b-versatile',
      ollama: 'llama3',
    };
    return modelMap[provider];
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
      plugins: { ...base.plugins, ...override.plugins },
      telemetry: { ...base.telemetry, ...override.telemetry },
      persistence: { ...base.persistence, ...override.persistence },
      server: { ...base.server, ...override.server },
    };
  }

  get(): XiaobaiConfig;
  get<K extends keyof XiaobaiConfig>(key: K): XiaobaiConfig[K];
  get(key?: keyof XiaobaiConfig): XiaobaiConfig | XiaobaiConfig[keyof XiaobaiConfig] {
    if (key !== undefined) return structuredClone(this.config[key]);
    return structuredClone(this.config);
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
    return structuredClone(DEFAULT_CONFIG);
  }
}
