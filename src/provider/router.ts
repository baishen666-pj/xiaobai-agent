import type { XiaobaiConfig } from '../config/manager.js';
import type { Message } from '../session/manager.js';
import type { ToolDefinition } from '../tools/registry.js';

export interface ProviderResponse {
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ChatOptions {
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export class ProviderRouter {
  private config: XiaobaiConfig;
  private clients = new Map<string, unknown>();

  constructor(config: XiaobaiConfig) {
    this.config = config;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ProviderResponse | null> {
    const provider = this.config.provider.default;
    const model = this.config.model.default;

    try {
      return await this.callProvider(provider, model, messages, options);
    } catch (error) {
      if (this.config.model.fallback) {
        return this.callProvider(provider, this.config.model.fallback, messages, options);
      }
      throw error;
    }
  }

  private async callProvider(
    provider: string,
    model: string,
    messages: Message[],
    options: ChatOptions,
  ): Promise<ProviderResponse> {
    const apiKey = this.config.provider.apiKey ?? this.getEnvKey(provider);

    if (provider === 'anthropic') {
      return this.callAnthropic(apiKey, model, messages, options);
    }

    return this.callOpenAICompatible(apiKey, model, messages, options);
  }

  private async callAnthropic(
    apiKey: string | undefined,
    model: string,
    messages: Message[],
    options: ChatOptions,
  ): Promise<ProviderResponse> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const formatted = messages
      .filter((m) => m.role !== 'tool_result')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 8192,
      system: options.system ?? '',
      messages: formatted,
      tools: options.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as unknown as Record<string, unknown>,
      })),
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use');

    return {
      content: textBlock && 'text' in textBlock ? textBlock.text : undefined,
      toolCalls: toolBlocks.map((b) => ({
        id: 'id' in b ? (b as { id: string }).id : '',
        name: 'name' in b ? (b as { name: string }).name : '',
        arguments: 'input' in b ? ((b as { input: Record<string, unknown> }).input) : {},
      })),
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  private async callOpenAICompatible(
    apiKey: string | undefined,
    model: string,
    messages: Message[],
    options: ChatOptions,
  ): Promise<ProviderResponse> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey,
      baseURL: this.config.provider.baseUrl,
    });

    const formatted = messages.map((m) => ({
      role: m.role === 'tool_result' ? 'tool' as const : m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    if (options.system) {
      formatted.unshift({ role: 'system', content: options.system });
    }

    const response = await client.chat.completions.create({
      model,
      messages: formatted,
      max_tokens: options.maxTokens ?? 8192,
      tools: options.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content ?? undefined,
      toolCalls: choice?.message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async summarize(messages: Message[]): Promise<string> {
    const compactModel = this.config.model.compact ?? this.config.model.fallback;
    const response = await this.chat(
      [
        {
          role: 'system',
          content: 'Summarize the following conversation concisely, preserving key decisions, facts, and context.',
        },
        ...messages.slice(-10),
      ],
      { maxTokens: 2000 },
    );
    return response?.content ?? 'Context summary unavailable';
  }

  private getEnvKey(provider: string): string | undefined {
    const envMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_API_KEY',
    };
    return process.env[envMap[provider] ?? 'XIAOBAI_API_KEY'];
  }
}
