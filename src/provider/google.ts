import type { Message } from '../session/manager.js';
import type { ProviderConfig, ProviderResponse, StreamChunk, ChatOptions, LLMProvider } from './types.js';

export class GoogleProvider implements LLMProvider {
  readonly name = 'google';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  async chat(messages: Message[], model: string, options: ChatOptions): Promise<ProviderResponse> {
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
    const body = this.buildRequestBody(messages, options);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;
    return this.parseResponse(data);
  }

  async *chatStream(messages: Message[], model: string, options: ChatOptions): AsyncGenerator<StreamChunk, void, void> {
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const body = this.buildRequestBody(messages, options);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const chunk = JSON.parse(jsonStr) as any;
          const candidate = chunk.candidates?.[0];
          if (!candidate) continue;

          const parts = candidate.content?.parts ?? [];
          for (const part of parts) {
            if (part.text) {
              yield { type: 'text_delta', text: part.text };
            }
            if (part.functionCall) {
              const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              yield {
                type: 'tool_call_start',
                toolCallId: callId,
                toolCallName: part.functionCall.name,
              };
              yield {
                type: 'tool_call_delta',
                toolCallId: callId,
                toolCallDelta: JSON.stringify(part.functionCall.args),
              };
            }
          }

          if (candidate.finishReason) {
            yield { type: 'done', stopReason: candidate.finishReason.toLowerCase() };
          }
        } catch {
          // skip invalid JSON
        }
      }
    }
  }

  private buildRequestBody(messages: Message[], options: ChatOptions) {
    const contents: any[] = [];
    const systemParts: string[] = [];
    const pendingToolResults = new Map<string, string>();

    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
        continue;
      }
      if (m.role === 'tool_result') {
        pendingToolResults.set(m.toolCallId ?? '', m.content);
        continue;
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          pendingToolResults.set(tc.id, '');
        }
        contents.push({ role: 'model', parts });
        continue;
      }
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }

    // Flush remaining tool results
    for (const [id, content] of pendingToolResults) {
      if (content) {
        contents.push({
          role: 'function',
          parts: [{ functionResponse: { name: id, response: { output: content } } }],
        });
      }
    }

    const combinedSystem = systemParts.join('\n\n');
    const body: any = { contents };
    if (options.system ?? combinedSystem) {
      body.systemInstruction = { parts: [{ text: options.system ?? combinedSystem ?? '' }] };
    }
    body.generationConfig = {
      maxOutputTokens: options.maxTokens ?? 8192,
      temperature: options.temperature,
    };
    if (options.tools?.length) {
      body.tools = [{
        functionDeclarations: options.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }
    return body;
  }

  private parseResponse(data: any): ProviderResponse {
    const candidate = data.candidates?.[0];
    if (!candidate) return { content: '' };

    const parts = candidate.content?.parts ?? [];
    let text = '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

    for (const part of parts) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    }

    const usage = data.usageMetadata;
    return {
      content: text || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: usage
        ? { promptTokens: usage.promptTokenCount ?? 0, completionTokens: usage.candidatesTokenCount ?? 0, totalTokens: usage.totalTokenCount ?? 0 }
        : undefined,
      stopReason: candidate.finishReason?.toLowerCase() as ProviderResponse['stopReason'],
    };
  }
}
