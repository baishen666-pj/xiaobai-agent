import type { Message } from '../session/manager.js';
import type { ProviderConfig, ProviderResponse, StreamChunk, ChatOptions, EmbeddingResponse, LLMProvider } from './types.js';

// ── Google Generative Language API types ──

interface GoogleContentPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { output: string } };
}

interface GoogleContent {
  role: 'user' | 'model' | 'function';
  parts: GoogleContentPart[];
}

interface GoogleCandidate {
  content?: { parts: GoogleContentPart[] };
  finishReason?: string;
}

interface GoogleUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GoogleGenerateResponse {
  candidates?: GoogleCandidate[];
  usageMetadata?: GoogleUsageMetadata;
}

interface GoogleRequestBody {
  contents: GoogleContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig: {
    maxOutputTokens: number;
    temperature?: number;
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
  };
  tools?: Array<{ functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }> }>;
}

export class GoogleProvider implements LLMProvider {
  readonly name = 'google';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  async chat(messages: Message[], model: string, options: ChatOptions): Promise<ProviderResponse> {
    const url = `${this.baseUrl}/models/${model}:generateContent`;
    const body = this.buildRequestBody(messages, options);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: options.abortSignal ?? undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const safeMessage = errorBody.length > 200 ? errorBody.slice(0, 200) + '...' : errorBody;
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = await response.json() as GoogleGenerateResponse;
    return this.parseResponse(data);
  }

  async *chatStream(messages: Message[], model: string, options: ChatOptions): AsyncGenerator<StreamChunk, void, void> {
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse`;
    const body = this.buildRequestBody(messages, options);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: options.abortSignal ?? undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const safeMessage = errorBody.length > 200 ? errorBody.slice(0, 200) + '...' : errorBody;
      throw new Error(`Google API error: ${response.status}`);
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
          const chunk = JSON.parse(jsonStr) as GoogleGenerateResponse;
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
        } catch (e) {
          console.debug('google: skip invalid JSON in stream chunk', (e as Error).message);
        }
      }
    }
  }

  private buildRequestBody(messages: Message[], options: ChatOptions): GoogleRequestBody {
    const contents: GoogleContent[] = [];
    const systemParts: string[] = [];
    const pendingToolResults = new Map<string, string>();

    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join(''));
        continue;
      }
      if (m.role === 'tool_result') {
        const textContent = typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('');
        pendingToolResults.set(m.toolCallId ?? '', textContent);
        continue;
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const parts: GoogleContentPart[] = [];
        const text = typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('');
        if (text) parts.push({ text });
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          pendingToolResults.set(tc.id, '');
        }
        contents.push({ role: 'model', parts });
        continue;
      }
      if (Array.isArray(m.content)) {
        const parts: GoogleContentPart[] = m.content.map(part => {
          if (part.type === 'text') return { text: part.text };
          if (part.type === 'image') return { inlineData: { mimeType: part.mimeType, data: part.data } };
          return { text: '' };
        });
        contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
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
    const generationConfig: GoogleRequestBody['generationConfig'] = {
      maxOutputTokens: options.maxTokens ?? 8192,
      temperature: options.temperature,
    };
    if (options.structured) {
      generationConfig.responseMimeType = 'application/json';
    }
    if (options.response_format) {
      const rf = options.response_format;
      const jsonSchemaObj = rf.json_schema as Record<string, unknown> | undefined;
      if (jsonSchemaObj?.schema) {
        generationConfig.responseSchema = jsonSchemaObj.schema as Record<string, unknown>;
      }
    }
    const body: GoogleRequestBody = { contents, generationConfig };
    if (options.system ?? combinedSystem) {
      body.systemInstruction = { parts: [{ text: options.system ?? combinedSystem ?? '' }] };
    }
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

  private parseResponse(data: GoogleGenerateResponse): ProviderResponse {
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

  async embed(text: string, model = 'text-embedding-004'): Promise<EmbeddingResponse> {
    const url = `${this.baseUrl}/models/${model}:embedContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] } }),
    });

    if (!response.ok) {
      throw new Error(`Google Embedding API error: ${response.status}`);
    }

    const data = await response.json() as {
      embedding?: { values?: number[] };
    };

    const values = data.embedding?.values;
    if (!values) throw new Error('No embedding returned from Google API');

    return { embedding: values };
  }
}