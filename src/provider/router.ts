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
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export interface StreamChunk {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'usage' | 'done';
  text?: string;
  toolCallId?: string;
  toolCallName?: string;
  toolCallDelta?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  stopReason?: string;
}

export interface ChatOptions {
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  abortSignal?: AbortSignal;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export class ProviderRouter {
  private config: XiaobaiConfig;
  private anthropicClient: InstanceType<typeof import('@anthropic-ai/sdk')['default']> | null = null;
  private openaiClient: InstanceType<typeof import('openai')['default']> | null = null;

  constructor(config: XiaobaiConfig) {
    this.config = config;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ProviderResponse | null> {
    const provider = this.config.provider.default;
    const model = this.config.model.default;

    return this.withRetry(provider, model, messages, options);
  }

  async *chatStream(messages: Message[], options: ChatOptions = {}): AsyncGenerator<StreamChunk, void, void> {
    const provider = this.config.provider.default;
    const model = this.config.model.default;
    const apiKey = this.config.provider.apiKey ?? this.getEnvKey(provider);

    if (provider === 'anthropic') {
      yield* this.streamAnthropic(apiKey, model, messages, options);
    } else {
      yield* this.streamOpenAI(apiKey, model, messages, options);
    }
  }

  async summarize(messages: Message[]): Promise<string> {
    const compactModel = this.config.model.compact ?? this.config.model.fallback;
    const response = await this.chat(
      [
        {
          role: 'system',
          content:
            'Summarize the following conversation concisely. Preserve:\n' +
            '- Key decisions and their rationale\n' +
            '- Important facts, numbers, and identifiers\n' +
            '- Tool calls made and their outcomes\n' +
            '- Current task state and next steps\n' +
            'Do NOT include pleasantries or meta-commentary.',
        },
        ...messages.slice(-20),
      ],
      { maxTokens: 2000 },
    );
    return response?.content ?? 'Context summary unavailable';
  }

  private async withRetry(
    provider: string,
    model: string,
    messages: Message[],
    options: ChatOptions,
    attempt = 0,
  ): Promise<ProviderResponse> {
    try {
      const apiKey = this.config.provider.apiKey ?? this.getEnvKey(provider);
      if (provider === 'anthropic') {
        return await this.callAnthropic(apiKey, model, messages, options);
      }
      return await this.callOpenAICompatible(apiKey, model, messages, options);
    } catch (error) {
      if (attempt >= MAX_RETRIES - 1 || !this.isRetryable(error)) {
        if (this.config.model.fallback && attempt === 0) {
          try {
            const fallbackModel = this.config.model.fallback;
            const apiKey = this.config.provider.apiKey ?? this.getEnvKey(provider);
            if (provider === 'anthropic') {
              return await this.callAnthropic(apiKey, fallbackModel, messages, options);
            }
            return await this.callOpenAICompatible(apiKey, fallbackModel, messages, options);
          } catch {
            throw error;
          }
        }
        throw error;
      }

      const delay = RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.withRetry(provider, model, messages, options, attempt + 1);
    }
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('rate') ||
        msg.includes('limit') ||
        msg.includes('overloaded') ||
        msg.includes('timeout') ||
        msg.includes('503') ||
        msg.includes('500') ||
        msg.includes('429') ||
        msg.includes('connection')
      );
    }
    return false;
  }

  private async getAnthropicClient(apiKey: string | undefined) {
    if (this.anthropicClient) return this.anthropicClient;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    this.anthropicClient = new Anthropic({ apiKey });
    return this.anthropicClient;
  }

  private async getOpenAIClient(apiKey: string | undefined) {
    if (this.openaiClient) return this.openaiClient;
    const { default: OpenAI } = await import('openai');
    this.openaiClient = new OpenAI({ apiKey, baseURL: this.config.provider.baseUrl });
    return this.openaiClient;
  }

  private formatAnthropicMessages(messages: Message[]) {
    const formatted: Array<{ role: 'user' | 'assistant'; content: string | Array<any> }> = [];

    for (const m of messages) {
      if (m.role === 'system') {
        continue;
      }
      if (m.role === 'tool_result') {
        const last = formatted[formatted.length - 1];
        if (last?.role === 'assistant' && Array.isArray(last.content)) {
          last.content.push({
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          });
        } else {
          formatted.push({
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content },
            ],
          });
        }
        continue;
      }
      formatted.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }

    return formatted as any;
  }

  private async callAnthropic(
    apiKey: string | undefined,
    model: string,
    messages: Message[],
    options: ChatOptions,
  ): Promise<ProviderResponse> {
    const client = await this.getAnthropicClient(apiKey);
    const formatted = this.formatAnthropicMessages(messages);

    const response = await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 8192,
      system: options.system ?? '',
      messages: formatted,
      tools: options.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { ...t.parameters } as any,
      })),
    });

    const textBlock = response.content.find((b) => b.type === 'text') as any;
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use') as any[];

    return {
      content: textBlock?.text ?? undefined,
      toolCalls: toolBlocks.length > 0
        ? toolBlocks.map((b: any) => ({
            id: b.id ?? '',
            name: b.name ?? '',
            arguments: b.input ?? {},
          }))
        : undefined,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      stopReason: response.stop_reason as ProviderResponse['stopReason'],
    };
  }

  private async *streamAnthropic(
    apiKey: string | undefined,
    model: string,
    messages: Message[],
    options: ChatOptions,
  ): AsyncGenerator<StreamChunk, void, void> {
    const client = await this.getAnthropicClient(apiKey);
    const formatted = this.formatAnthropicMessages(messages);

    const stream = client.messages.stream({
      model,
      max_tokens: options.maxTokens ?? 8192,
      system: options.system ?? '',
      messages: formatted,
      tools: options.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { ...t.parameters } as any,
      })),
    });

    let currentToolId = '';
    let currentToolName = '';

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            yield { type: 'tool_call_delta', toolCallId: currentToolId, toolCallDelta: event.delta.partial_json };
          }
          break;
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            yield {
              type: 'tool_call_start',
              toolCallId: currentToolId,
              toolCallName: currentToolName,
            };
          }
          break;
        case 'message_delta':
          if (event.usage) {
            yield {
              type: 'usage',
              usage: {
                promptTokens: 0,
                completionTokens: event.usage.output_tokens,
                totalTokens: event.usage.output_tokens,
              },
            };
          }
          if (event.delta?.stop_reason) {
            yield { type: 'done', stopReason: event.delta.stop_reason };
          }
          break;
      }
    }
  }

  private formatOpenAIMessages(messages: Message[], system?: string) {
    const formatted: Array<Record<string, unknown>> = [];

    if (system) {
      formatted.push({ role: 'system', content: system });
    }

    for (const m of messages) {
      if (m.role === 'system') {
        formatted.push({ role: 'system', content: m.content });
        continue;
      }
      if (m.role === 'tool_result') {
        formatted.push({
          role: 'tool',
          content: m.content,
          tool_call_id: m.toolCallId ?? '',
        });
        continue;
      }
      formatted.push({ role: m.role, content: m.content });
    }

    return formatted;
  }

  private async callOpenAICompatible(
    apiKey: string | undefined,
    model: string,
    messages: Message[],
    options: ChatOptions,
  ): Promise<ProviderResponse> {
    const client = await this.getOpenAIClient(apiKey);
    const formatted = this.formatOpenAIMessages(messages, options.system);

    const response = await client.chat.completions.create({
      model,
      messages: formatted as any,
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
      stopReason: choice?.finish_reason as ProviderResponse['stopReason'],
    };
  }

  private async *streamOpenAI(
    apiKey: string | undefined,
    model: string,
    messages: Message[],
    options: ChatOptions,
  ): AsyncGenerator<StreamChunk, void, void> {
    const client = await this.getOpenAIClient(apiKey);
    const formatted = this.formatOpenAIMessages(messages, options.system);

    const stream = await client.chat.completions.create({
      model,
      messages: formatted as any,
      max_tokens: options.maxTokens ?? 8192,
      stream: true,
      tools: options.tools?.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    });

    const toolCallStates = new Map<number, { id: string; name: string; args: string }>();
    let lastFinishReason: string | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason) lastFinishReason = finishReason;
      if (!delta) continue;

      if (delta.content) {
        yield { type: 'text_delta', text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallStates.has(idx) && tc.id) {
            toolCallStates.set(idx, { id: tc.id, name: tc.function?.name ?? '', args: '' });
            yield {
              type: 'tool_call_start',
              toolCallId: tc.id,
              toolCallName: tc.function?.name ?? '',
            };
          }
          if (tc.function?.arguments) {
            const state = toolCallStates.get(idx);
            if (state) state.args += tc.function.arguments;
            yield {
              type: 'tool_call_delta',
              toolCallId: state?.id ?? '',
              toolCallDelta: tc.function.arguments,
            };
          }
        }
      }

      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          },
        };
      }
    }

    yield { type: 'done', stopReason: lastFinishReason };
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
