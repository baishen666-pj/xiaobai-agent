import type { Message } from '../session/manager.js';
import type { ProviderConfig, ProviderResponse, StreamChunk, ChatOptions, EmbeddingResponse, LLMProvider } from './types.js';

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string | undefined;
  private client: InstanceType<typeof import('openai')['default']> | null = null;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.baseUrl;
  }

  private async getClient() {
    if (this.client) return this.client;
    const { default: OpenAI } = await import('openai');
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    });
    return this.client;
  }

  async chat(messages: Message[], model: string, options: ChatOptions): Promise<ProviderResponse> {
    const client = await this.getClient();
    const formatted = this.formatMessages(messages);

    const createParams = {
      model,
      messages: formatted,
      max_tokens: options.maxTokens ?? 8192,
      tools: options.tools?.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      ...(options.response_format ? { response_format: options.response_format } : {}),
    };

    const response = await client.chat.completions.create(
      createParams as Parameters<typeof client.chat.completions.create>[0],
      { signal: options.abortSignal ?? undefined },
    ) as Awaited<ReturnType<typeof client.chat.completions.create>>;

    if (!('choices' in response) || Symbol.asyncIterator in response) {
      throw new Error('Expected non-streaming response from OpenAI');
    }

    const choice = response.choices[0];
    if (!choice) return { content: '' };

    const toolCalls = choice.message?.tool_calls?.map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments ?? '{}');
      } catch { /* malformed arguments fallback to empty object */ }
      return { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: args };
    });

    return {
      content: choice.message?.content ?? undefined,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: response.usage
        ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens }
        : undefined,
      stopReason: choice.finish_reason as ProviderResponse['stopReason'],
    };
  }

  async *chatStream(messages: Message[], model: string, options: ChatOptions): AsyncGenerator<StreamChunk, void, void> {
    const client = await this.getClient();
    const formatted = this.formatMessages(messages);

    const streamParams = {
      model,
      messages: formatted,
      max_tokens: options.maxTokens ?? 8192,
      stream: true as const,
      tools: options.tools?.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      ...(options.response_format ? { response_format: options.response_format } : {}),
    };

    const stream = await client.chat.completions.create(
      streamParams as Parameters<typeof client.chat.completions.create>[0],
      { signal: options.abortSignal ?? undefined },
    );

    if (!(Symbol.asyncIterator in stream)) {
      throw new Error('Expected streaming response from OpenAI');
    }

    let currentToolId = '';
    let currentToolName = '';

    for await (const chunk of stream as AsyncIterable<import('openai/resources/chat/completions').ChatCompletionChunk>) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: 'text_delta', text: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            currentToolId = tc.id;
            currentToolName = tc.function?.name ?? '';
            yield { type: 'tool_call_start', toolCallId: currentToolId, toolCallName: currentToolName };
          }
          if (tc.function?.arguments) {
            yield { type: 'tool_call_delta', toolCallId: currentToolId, toolCallDelta: tc.function.arguments };
          }
        }
      }

      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason) {
        yield { type: 'done', stopReason: finishReason };
      }

      if (chunk.usage) {
        yield { type: 'usage', usage: { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens } };
      }
    }
  }

  async embed(text: string, model = 'text-embedding-3-small'): Promise<EmbeddingResponse> {
    const baseUrl = this.baseUrl ?? 'https://api.openai.com/v1';
    const url = `${baseUrl.replace(/\/$/, '')}/embeddings`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens: number; total_tokens: number };
    };

    const embedding = data.data?.[0]?.embedding;
    if (!embedding) throw new Error('No embedding returned from API');

    return {
      embedding,
      usage: data.usage
        ? { promptTokens: data.usage.prompt_tokens, totalTokens: data.usage.total_tokens }
        : undefined,
    };
  }

  private formatMessages(messages: Message[]) {
    type OpenAIMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>; tool_call_id?: string };

    const formatted: OpenAIMessage[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        formatted.push({ role: 'system', content: m.content });
        continue;
      }
      if (m.role === 'tool_result') {
        formatted.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' });
        continue;
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        formatted.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments) },
          })),
        });
        continue;
      }
      formatted.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }
    return formatted;
  }
}