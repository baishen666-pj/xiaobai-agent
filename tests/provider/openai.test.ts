import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OpenAI SDK before import
vi.mock('openai', () => {
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } };
    },
  };

  const mockCompletions = {
    create: vi.fn().mockResolvedValue({
      choices: [{
        message: { content: 'Hi there!', tool_calls: undefined },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  };

  // Second mock for streaming
  mockCompletions.create.mockImplementation(async (opts: any) => {
    if (opts.stream) return mockStream;
    return {
      choices: [{
        message: { content: 'Hi there!', tool_calls: undefined },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  });

  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: mockCompletions },
    })),
  };
});

import { OpenAICompatibleProvider } from '../../src/provider/openai.js';
import type { Message } from '../../src/session/manager.js';

function makeMessages(content = 'Hello', role: Message['role'] = 'user'): Message[] {
  return [{ role, content, timestamp: Date.now() }];
}

const defaultOptions = {
  system: 'You are a helpful assistant.',
  tools: [],
  maxTokens: 1024,
};

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    provider = new OpenAICompatibleProvider({ name: 'openai', apiKey: 'test-key' });
  });

  it('has correct name', () => {
    expect(provider.name).toBe('openai');
  });

  describe('chat', () => {
    it('returns text response', async () => {
      const result = await provider.chat(makeMessages(), 'gpt-4', defaultOptions);
      expect(result.content).toBe('Hi there!');
      expect(result.usage?.totalTokens).toBe(15);
      expect(result.stopReason).toBe('stop');
    });

    it('returns tool calls', async () => {
      const { default: MockOpenAI } = await import('openai');
      const instance = new MockOpenAI();
      instance.chat.completions.create.mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'Let me read that.',
            tool_calls: [{
              id: 'tc1',
              function: { name: 'read', arguments: '{"file_path":"/tmp/test.txt"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const result = await provider.chat(makeMessages('Read test.txt'), 'gpt-4', defaultOptions);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].name).toBe('read');
      expect(result.toolCalls![0].arguments.file_path).toBe('/tmp/test.txt');
    });

    it('handles malformed tool call arguments', async () => {
      const { default: MockOpenAI } = await import('openai');
      const instance = new MockOpenAI();
      instance.chat.completions.create.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'tc1',
              function: { name: 'test', arguments: 'not-valid-json' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: null,
      });

      const result = await provider.chat(makeMessages(), 'gpt-4', defaultOptions);
      expect(result.toolCalls![0].arguments).toEqual({});
    });
  });

  describe('chatStream', () => {
    it('yields text delta chunks', async () => {
      const chunks: any[] = [];
      for await (const chunk of provider.chatStream!(makeMessages(), 'gpt-4', defaultOptions)) {
        chunks.push(chunk);
      }
      expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
      expect(chunks.some((c) => c.type === 'done')).toBe(true);
      expect(chunks.some((c) => c.type === 'usage')).toBe(true);
    });
  });

  describe('formatMessages', () => {
    it('includes system message in formatted output', async () => {
      const messages: Message[] = [
        { role: 'system', content: 'Be helpful', timestamp: Date.now() },
        { role: 'user', content: 'Hello', timestamp: Date.now() },
      ];
      // Should not throw
      const result = await provider.chat(messages, 'gpt-4', defaultOptions);
      expect(result).toBeDefined();
    });

    it('handles tool_result messages', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Read file', timestamp: Date.now() },
        { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/t' } }], timestamp: Date.now() },
        { role: 'tool_result', toolCallId: 'tc1', content: 'contents', timestamp: Date.now() },
      ];
      const result = await provider.chat(messages, 'gpt-4', defaultOptions);
      expect(result).toBeDefined();
    });

    it('handles assistant with toolCalls', async () => {
      const messages: Message[] = [
        { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'read', arguments: {} }], timestamp: Date.now() },
      ];
      const result = await provider.chat(messages, 'gpt-4', defaultOptions);
      expect(result).toBeDefined();
    });
  });
});
