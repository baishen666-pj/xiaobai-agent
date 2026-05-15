import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleProvider } from '../../src/provider/google.js';
import type { Message } from '../../src/session/manager.js';

function makeMessages(content = 'Hello', role: Message['role'] = 'user'): Message[] {
  return [{ role, content, timestamp: Date.now() }];
}

const defaultOptions = {
  system: 'You are a helpful assistant.',
  tools: [],
  maxTokens: 1024,
};

describe('GoogleProvider', () => {
  let provider: GoogleProvider;

  beforeEach(() => {
    provider = new GoogleProvider({ name: 'google', apiKey: 'test-key' });
  });

  it('has name "google"', () => {
    expect(provider.name).toBe('google');
  });

  describe('chat', () => {
    it('returns parsed response', async () => {
      const mockResponse = {
        candidates: [{
          content: { parts: [{ text: 'Hello! How can I help?' }] },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await provider.chat(makeMessages(), 'gemini-pro', defaultOptions);
      expect(result.content).toBe('Hello! How can I help?');
      expect(result.usage?.totalTokens).toBe(30);
    });

    it('returns tool calls', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'read', args: { file_path: '/tmp/test.txt' } },
            }],
          },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await provider.chat(makeMessages('Read test.txt'), 'gemini-pro', defaultOptions);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].name).toBe('read');
    });

    it('throws on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
      } as Response);

      await expect(provider.chat(makeMessages(), 'gemini-pro', defaultOptions))
        .rejects.toThrow('Google API error: 429');
    });

    it('handles empty candidates', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ candidates: [] }),
      } as Response);

      const result = await provider.chat(makeMessages(), 'gemini-pro', defaultOptions);
      expect(result.content).toBe('');
    });

    it('passes abortSignal to fetch', async () => {
      const controller = new AbortController();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ candidates: [] }),
      } as Response);

      await provider.chat(makeMessages(), 'gemini-pro', { ...defaultOptions, abortSignal: controller.signal });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  describe('chatStream', () => {
    it('yields text delta chunks', async () => {
      const sseData = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":"STOP"}]}',
        'data: [DONE]',
      ].join('\n');

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        body: stream,
      } as Response);

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream!(makeMessages(), 'gemini-pro', defaultOptions)) {
        chunks.push(chunk);
      }

      expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
    });

    it('throws on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      } as Response);

      const gen = provider.chatStream!(makeMessages(), 'gemini-pro', defaultOptions);
      await expect(gen.next()).rejects.toThrow('Google API error: 500');
    });
  });

  describe('buildRequestBody (via chat)', () => {
    it('handles system messages', async () => {
      const messages: Message[] = [
        { role: 'system', content: 'Be concise', timestamp: Date.now() },
        { role: 'user', content: 'Hello', timestamp: Date.now() },
      ];

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
        const body = JSON.parse(opts.body);
        expect(body.systemInstruction).toBeDefined();
        return { ok: true, json: () => Promise.resolve({ candidates: [] }) } as Response;
      });

      await provider.chat(messages, 'gemini-pro', defaultOptions);
    });

    it('handles tool_result messages', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Read file', timestamp: Date.now() },
        { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/t' } }], timestamp: Date.now() },
        { role: 'tool_result', toolCallId: 'tc1', content: 'file contents', timestamp: Date.now() },
      ];

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
        const body = JSON.parse(opts.body);
        expect(body.contents.length).toBeGreaterThan(0);
        return { ok: true, json: () => Promise.resolve({ candidates: [] }) } as Response;
      });

      await provider.chat(messages, 'gemini-pro', defaultOptions);
    });

    it('includes tools when provided', async () => {
      const tools = [{
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
      }];

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
        const body = JSON.parse(opts.body);
        expect(body.tools).toBeDefined();
        expect(body.tools[0].functionDeclarations[0].name).toBe('read');
        return { ok: true, json: () => Promise.resolve({ candidates: [] }) } as Response;
      });

      await provider.chat(makeMessages(), 'gemini-pro', { ...defaultOptions, tools });
    });
  });
});
