import type { Message } from '../session/manager.js';
import type { ProviderConfig, ProviderResponse, StreamChunk, ChatOptions, LLMProvider } from './types.js';

export class AnthropicProvider implements LLMProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string | undefined;
  private client: InstanceType<typeof import('@anthropic-ai/sdk')['default']> | null = null;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.baseUrl;
  }

  private async getClient() {
    if (this.client) return this.client;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    this.client = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    });
    return this.client;
  }

  async chat(messages: Message[], model: string, options: ChatOptions): Promise<ProviderResponse> {
    const client = await this.getClient();
    const formatted = this.formatMessages(messages);

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
      ...(options.tool_choice ? { tool_choice: options.tool_choice as any } : {}),
    }, { signal: options.abortSignal });

    const textBlock = response.content.find((b) => b.type === 'text') as any;
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use') as any[];

    return {
      content: textBlock?.text ?? undefined,
      toolCalls: toolBlocks.length > 0
        ? toolBlocks.map((b: any) => ({ id: b.id ?? '', name: b.name ?? '', arguments: b.input ?? {} }))
        : undefined,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      stopReason: response.stop_reason as ProviderResponse['stopReason'],
    };
  }

  async *chatStream(messages: Message[], model: string, options: ChatOptions): AsyncGenerator<StreamChunk, void, void> {
    const client = await this.getClient();
    const formatted = this.formatMessages(messages);

    let inputTokens = 0;

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
      ...(options.tool_choice ? { tool_choice: options.tool_choice as any } : {}),
    }, { signal: options.abortSignal });

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
            yield { type: 'tool_call_start', toolCallId: currentToolId, toolCallName: currentToolName };
          }
          break;
        case 'message_start':
          inputTokens = event.message?.usage?.input_tokens ?? 0;
          break;
        case 'message_delta':
          if (event.usage) {
            yield { type: 'usage', usage: { promptTokens: inputTokens, completionTokens: event.usage.output_tokens, totalTokens: inputTokens + event.usage.output_tokens } };
          }
          if (event.delta?.stop_reason) {
            yield { type: 'done', stopReason: event.delta.stop_reason };
          }
          break;
      }
    }
  }

  private formatMessages(messages: Message[]) {
    const formatted: Array<{ role: 'user' | 'assistant'; content: string | Array<any> }> = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool_result') {
        const last = formatted[formatted.length - 1];
        if (last?.role === 'assistant' && Array.isArray(last.content)) {
          last.content.push({ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content });
        } else {
          formatted.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }] });
        }
        continue;
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const content: Array<any> = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content });
        }
        for (const tc of m.toolCalls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
        formatted.push({ role: 'assistant', content });
        continue;
      }
      formatted.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }
    return formatted as any;
  }
}
