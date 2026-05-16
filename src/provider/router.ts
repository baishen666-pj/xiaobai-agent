import type { XiaobaiConfig } from '../config/manager.js';
import type { Message } from '../session/manager.js';
import type { ToolDefinition } from '../tools/registry.js';
import type { ProviderResponse, StreamChunk, ChatOptions, ProviderConfig, LLMProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai.js';
import { GoogleProvider } from './google.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { RateLimiter } from './rate-limiter.js';
import { ProviderMetrics } from './provider-metrics.js';

export type { ProviderResponse, StreamChunk, ChatOptions, ProviderConfig, LLMProvider } from './types.js';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

const PROVIDER_FACTORIES: Record<string, (config: ProviderConfig) => LLMProvider> = {
  // Western providers
  anthropic: (c) => new AnthropicProvider(c),
  openai: (c) => new OpenAICompatibleProvider({ ...c, name: 'openai' }),
  google: (c) => new GoogleProvider(c),
  groq: (c) => new OpenAICompatibleProvider({ ...c, name: 'groq', baseUrl: c.baseUrl ?? 'https://api.groq.com/openai/v1' }),
  ollama: (c) => new OpenAICompatibleProvider({ ...c, name: 'ollama', baseUrl: c.baseUrl ?? 'http://localhost:11434/v1', apiKey: c.apiKey ?? 'ollama' }),

  // Chinese LLM providers
  deepseek: (c) => new OpenAICompatibleProvider({ ...c, name: 'deepseek', baseUrl: c.baseUrl ?? 'https://api.deepseek.com/v1' }),
  zhipu: (c) => new OpenAICompatibleProvider({ ...c, name: 'zhipu', baseUrl: c.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4' }),
  qwen: (c) => new OpenAICompatibleProvider({ ...c, name: 'qwen', baseUrl: c.baseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1' }),
  moonshot: (c) => new OpenAICompatibleProvider({ ...c, name: 'moonshot', baseUrl: c.baseUrl ?? 'https://api.moonshot.cn/v1' }),
  yi: (c) => new OpenAICompatibleProvider({ ...c, name: 'yi', baseUrl: c.baseUrl ?? 'https://api.lingyiwanwu.com/v1' }),
  baidu: (c) => new OpenAICompatibleProvider({ ...c, name: 'baidu', baseUrl: c.baseUrl ?? 'https://qianfan.baidubce.com/v2' }),
  minimax: (c) => new OpenAICompatibleProvider({ ...c, name: 'minimax', baseUrl: c.baseUrl ?? 'https://api.minimax.chat/v1' }),
  baichuan: (c) => new OpenAICompatibleProvider({ ...c, name: 'baichuan', baseUrl: c.baseUrl ?? 'https://api.baichuan-ai.com/v1' }),

  // Web subscription (session token) providers
  'claude-web': (c) => new AnthropicProvider({ ...c, name: 'claude-web' }),
  'chatgpt-web': (c) => new OpenAICompatibleProvider({ ...c, name: 'chatgpt-web', baseUrl: c.baseUrl ?? 'https://api.openai.com/v1' }),

  // Generic fallback
  openaiCompatible: (c) => new OpenAICompatibleProvider(c),
};

export interface RouterOptions {
  circuitBreaker?: CircuitBreaker;
  rateLimiter?: RateLimiter;
  metrics?: ProviderMetrics;
}

export class ProviderRouter {
  private config: XiaobaiConfig;
  private providers = new Map<string, LLMProvider>();
  private pluginFactories = new Map<string, (config: ProviderConfig) => LLMProvider>();
  private circuitBreaker?: CircuitBreaker;
  private rateLimiter?: RateLimiter;
  private metrics?: ProviderMetrics;

  constructor(config: XiaobaiConfig, options?: RouterOptions) {
    this.config = config;
    this.circuitBreaker = options?.circuitBreaker;
    this.rateLimiter = options?.rateLimiter;
    this.metrics = options?.metrics;
  }

  registerProviderFactory(name: string, factory: (config: ProviderConfig) => LLMProvider): void {
    this.pluginFactories.set(name, factory);
  }

  unregisterProviderFactory(name: string): void {
    this.pluginFactories.delete(name);
    this.providers.delete(name);
  }

  getProvider(providerName?: string): LLMProvider {
    const name = providerName ?? this.config.provider.default;

    const cached = this.providers.get(name);
    if (cached) return cached;

    const factory = PROVIDER_FACTORIES[name];
    const pluginFactory = this.pluginFactories.get(name);

    if (pluginFactory) {
      const apiKey = this.config.provider.apiKey ?? this.getEnvKey(name);
      const provider = pluginFactory({ name, apiKey, baseUrl: this.config.provider.baseUrl });
      this.providers.set(name, provider);
      return provider;
    }

    if (!factory) {
      // Unknown provider — treat as OpenAI-compatible with custom base URL
      const provider = new OpenAICompatibleProvider({
        name,
        apiKey: this.getEnvKey(name) ?? this.config.provider.apiKey,
        baseUrl: this.config.provider.baseUrl,
      });
      this.providers.set(name, provider);
      return provider;
    }

    const apiKey = this.config.provider.apiKey ?? this.getEnvKey(name);
    const provider = factory({ name, apiKey, baseUrl: this.config.provider.baseUrl });
    this.providers.set(name, provider);
    return provider;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ProviderResponse | null> {
    const providerName = this.selectProvider();
    const model = this.config.model.default;

    // Rate limiting
    if (this.rateLimiter && !this.rateLimiter.acquire(providerName)) {
      const waited = await this.rateLimiter.acquireOrWait(providerName, 1, 5000);
      if (!waited) throw new Error(`Rate limit exceeded for ${providerName}`);
    }

    return this.withRetry(providerName, model, messages, options);
  }

  async *chatStream(messages: Message[], options: ChatOptions = {}): AsyncGenerator<StreamChunk, void, void> {
    const providerName = this.config.provider.default;
    const model = this.config.model.default;
    const provider = this.getProvider(providerName);

    if (provider.chatStream) {
      yield* provider.chatStream(messages, model, options);
    } else {
      const response = await provider.chat(messages, model, options);
      if (response.content) {
        yield { type: 'text_delta', text: response.content };
      }
      yield { type: 'done', stopReason: response.stopReason };
    }
  }

  async summarize(messages: Message[]): Promise<string> {
    const compactModel = this.config.model.compact ?? this.config.model.fallback ?? this.config.model.default;
    const provider = this.getProvider(this.config.provider.default);
    const response = await provider.chat(
      [
        { role: 'system', content: 'Summarize the following conversation concisely, preserving key decisions, facts, and context.' },
        ...messages.slice(-20),
      ],
      compactModel,
      { maxTokens: 2000 },
    );
    return response.content ?? 'Context summary unavailable';
  }

  private async withRetry(
    providerName: string,
    model: string,
    messages: Message[],
    options: ChatOptions,
    attempt = 0,
  ): Promise<ProviderResponse> {
    // Circuit breaker check
    if (this.circuitBreaker && !this.circuitBreaker.isAvailable()) {
      const fallback = await this.tryFallbackProvider(messages, options);
      if (fallback) return fallback;
      throw new Error(`Circuit breaker open for ${providerName}, no fallback available`);
    }

    const start = Date.now();
    try {
      if (this.circuitBreaker) this.circuitBreaker.beginHalfOpenAttempt();
      const provider = this.getProvider(providerName);
      const response = await provider.chat(messages, model, options);

      this.circuitBreaker?.recordSuccess();
      this.recordMetrics(providerName, model, start, response, true);

      return response;
    } catch (error) {
      this.circuitBreaker?.recordFailure();
      this.recordMetrics(providerName, model, start, null, false, error);

      if (attempt >= MAX_RETRIES - 1 || !this.isRetryable(error)) {
        // Try fallback model on same provider
        if (this.config.model.fallback && attempt === 0) {
          try {
            const fbModel = this.config.model.fallback;
            const provider = this.getProvider(providerName);
            return await provider.chat(messages, fbModel, options);
          } catch {
            // Try cross-provider failover
            const crossFallback = await this.tryFallbackProvider(messages, options);
            if (crossFallback) return crossFallback;
            throw error;
          }
        }
        throw error;
      }

      const delay = RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.withRetry(providerName, model, messages, options, attempt + 1);
    }
  }

  private async tryFallbackProvider(
    messages: Message[],
    options: ChatOptions,
  ): Promise<ProviderResponse | null> {
    const fallbacks = this.config.provider.fallbacks;
    if (!fallbacks?.length) return null;

    for (const fb of fallbacks) {
      try {
        const provider = this.getProvider(fb.name);
        const model = this.config.model.default;
        const response = await provider.chat(messages, model, options);
        this.circuitBreaker?.recordSuccess();
        this.recordMetrics(fb.name, model, Date.now(), response, true);
        return response;
      } catch {
        this.circuitBreaker?.recordFailure();
      }
    }
    return null;
  }

  private selectProvider(): string {
    return this.config.provider.default;
  }

  private recordMetrics(
    provider: string,
    model: string,
    startMs: number,
    response: ProviderResponse | null,
    success: boolean,
    error?: unknown,
  ): void {
    if (!this.metrics) return;
    const latencyMs = Date.now() - startMs;
    this.metrics.record({
      provider,
      model,
      latencyMs,
      promptTokens: response?.usage?.promptTokens ?? 0,
      completionTokens: response?.usage?.completionTokens ?? 0,
      success,
      errorType: error instanceof Error ? error.message.slice(0, 100) : undefined,
      timestamp: Date.now(),
    });
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return msg.includes('rate') || msg.includes('limit') || msg.includes('overloaded') ||
        msg.includes('timeout') || msg.includes('503') || msg.includes('500') ||
        msg.includes('429') || msg.includes('connection');
    }
    return false;
  }

  private getEnvKey(provider: string): string | undefined {
    const envMap: Record<string, string[]> = {
      anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
      openai: ['OPENAI_API_KEY'],
      google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      groq: ['GROQ_API_KEY'],
      ollama: [],
      deepseek: ['DEEPSEEK_API_KEY'],
      zhipu: ['ZHIPU_API_KEY'],
      qwen: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
      moonshot: ['MOONSHOT_API_KEY'],
      yi: ['YI_API_KEY'],
      baidu: ['BAIDU_API_KEY'],
      minimax: ['MINIMAX_API_KEY'],
      baichuan: ['BAICHUAN_API_KEY'],
      'claude-web': ['CLAUDE_WEB_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'],
      'chatgpt-web': ['CHATGPT_WEB_TOKEN', 'OPENAI_SESSION_TOKEN', 'OPENAI_API_KEY'],
    };
    const keys = envMap[provider] ?? [];
    for (const key of keys) {
      if (process.env[key]) return process.env[key];
    }
    return process.env['XIAOBAI_API_KEY'];
  }

  static getAvailableProviders(): string[] {
    return Object.keys(PROVIDER_FACTORIES);
  }

  updateConfig(updates: { provider?: string; model?: string }): void {
    if (updates.provider) {
      this.providers.delete(this.config.provider.default);
      this.config.provider.default = updates.provider;
    }
    if (updates.model) {
      this.config.model.default = updates.model;
    }
  }

  // ── Dual-model routing (from Aider pattern) ──

  async chatWithRole(
    messages: Message[],
    role: 'architect' | 'editor' | 'reviewer' | 'default',
    options: ChatOptions = {},
  ): Promise<ProviderResponse | null> {
    const roleConfig = this.getRoleConfig(role);
    const provider = this.getProvider(roleConfig.provider);
    return provider.chat(messages, roleConfig.model, options);
  }

  async *chatStreamWithRole(
    messages: Message[],
    role: 'architect' | 'editor' | 'reviewer' | 'default',
    options: ChatOptions = {},
  ): AsyncGenerator<StreamChunk, void, void> {
    const roleConfig = this.getRoleConfig(role);
    const provider = this.getProvider(roleConfig.provider);
    if (provider.chatStream) {
      yield* provider.chatStream(messages, roleConfig.model, options);
    } else {
      const response = await provider.chat(messages, roleConfig.model, options);
      if (response.content) yield { type: 'text_delta', text: response.content };
      yield { type: 'done', stopReason: response.stopReason };
    }
  }

  private getRoleConfig(role: string): { provider: string; model: string } {
    const cfg = this.config;
    const aux = cfg.auxiliary ?? {};

    switch (role) {
      case 'architect':
        return {
          provider: aux.architectProvider ?? cfg.provider.default,
          model: aux.architectModel ?? cfg.model.default,
        };
      case 'editor':
        return {
          provider: aux.editorProvider ?? cfg.provider.default,
          model: aux.editorModel ?? cfg.model.fallback ?? cfg.model.default,
        };
      case 'reviewer':
        return {
          provider: aux.reviewerProvider ?? cfg.provider.default,
          model: aux.reviewerModel ?? cfg.model.default,
        };
      default:
        return {
          provider: cfg.provider.default,
          model: cfg.model.default,
        };
    }
  }
}
