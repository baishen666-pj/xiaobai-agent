import type { Message } from '../session/manager.js';
import type { ProviderConfig, ProviderResponse, StreamChunk, ChatOptions, LLMProvider } from './types.js';

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
    this.client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl });
    return this.client;
  }

  async chat(messages: Message[], model: string, options: ChatOptions): Promise<ProviderResponse> {
    const client = await this.getClient();
    const formatted = this.formatMessages(messages, options.system);

    const response = await client.chat.completions.create({
      model,
      messages: formatted as any,
      max_tokens: options.maxTokens ?? 8192,
      tools: options.tools?.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    }, { signal: options.abortSignal ?? undefined });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content ?? undefined,
      toolCalls: choice?.message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
      })),
      usage: response.usage
        ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens }
        : undefined,
      stopReason: choice?.finish_reason as ProviderResponse['stopReason'],
    };
  }

  async *chatStream(messages: Message[], model: string, options: ChatOptions): AsyncGenerator<StreamChunk, void, void> {
    const client = await this.getClient();
    const formatted = this.formatMessages(messages, options.system);

    const stream = await client.chat.completions.create({
      model,
      messages: formatted as any,
      max_tokens: options.maxTokens ?? 8192,
      stream: true,
      tools: options.tools?.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    }, { signal: options.abortSignal ?? undefined });

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
            yield { type: 'tool_call_start', toolCallId: tc.id, toolCallName: tc.function?.name ?? '' };
          }
          if (tc.function?.arguments) {
            const state = toolCallStates.get(idx);
            if (state) {
              state.args += tc.function.arguments;
              yield { type: 'tool_call_delta', toolCallId: state.id, toolCallDelta: tc.function.arguments };
            }
          }
        }
      }

      if (chunk.usage) {
        yield { type: 'usage', usage: { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens } };
      }
    }

    yield { type: 'done', stopReason: lastFinishReason };
  }

  private formatMessages(messages: Message[], system?: string) {
    const formatted: Array<Record<string, unknown>> = [];
    if (system) formatted.push({ role: 'system', content: system });
    for (const m of messages) {
      if (m.role === 'system') { formatted.push({ role: 'system', content: m.content }); continue; }
      if (m.role === 'tool_result') { formatted.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' }); continue; }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        formatted.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
        continue;
      }
      formatted.push({ role: m.role, content: m.content });
    }
    return formatted;
  }
}
