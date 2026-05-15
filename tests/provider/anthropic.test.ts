import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Anthropic SDK before import
vi.mock('@anthropic-ai/sdk', () => {
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      yield { type: 'message_start', message: { usage: { input_tokens: 10 } } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
      yield { type: 'message_delta', usage: { output_tokens: 5 }, delta: { stop_reason: 'end_turn' } };
    },
  };

  const mockMessages = {
    create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hi there!' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    }),
    stream: vi.fn().mockReturnValue(mockStream),
  };

  return {
    default: vi.fn().mockImplementation(() => ({ messages: mockMessages })),
  };
});

import { AnthropicProvider } from '../../src/provider/anthropic.js';
import type { Message } from '../../src/session/manager.js';

function makeMessages(content = 'Hello', role: Message['role'] = 'user'): Message[] {
  return [{ role, content, timestamp: Date.now() }];
}

const defaultOptions = {
  system: 'You are a helpful assistant.',
  tools: [],
  maxTokens: 1024,
};

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider({ name: 'anthropic', apiKey: 'test-key' });
  });

  it('has correct name', () => {
    expect(provider.name).toBe('anthropic');
  });

  describe('chat', () => {
    it('returns text response', async () => {
      const result = await provider.chat(makeMessages(), 'claude-3-opus', defaultOptions);
      expect(result.content).toBe('Hi there!');
      expect(result.usage?.totalTokens).toBe(15);
      expect(result.stopReason).toBe('end_turn');
    });

    it('returns tool calls', async () => {
      const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
      const instance = new MockAnthropic();
      instance.messages.create.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Let me read that file.' },
          { type: 'tool_use', id: 'tc1', name: 'read', input: { file_path: '/tmp/test.txt' } },
        ],
        usage: { input_tokens: 20, output_tokens: 15 },
        stop_reason: 'tool_use',
      });

      const result = await provider.chat(makeMessages(), 'claude-3-opus', defaultOptions);
      expect(result.content).toBe('Let me read that file.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].name).toBe('read');
    });
  });

  describe('chatStream', () => {
    it('yields text delta chunks', async () => {
      const chunks: any[] = [];
      for await (const chunk of provider.chatStream!(makeMessages(), 'claude-3-opus', defaultOptions)) {
        chunks.push(chunk);
      }
      expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
      expect(chunks.some((c) => c.type === 'done')).toBe(true);
    });
  });

  describe('formatMessages', () => {
    it('handles tool_result messages', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Read file', timestamp: Date.now() },
        { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'read', arguments: { file_path: '/t' } }], timestamp: Date.now() },
        { role: 'tool_result', toolCallId: 'tc1', content: 'contents', timestamp: Date.now() },
      ];
      const result = await provider.chat(messages, 'claude-3-opus', defaultOptions);
      expect(result).toBeDefined();
    });

    it('skips system messages', async () => {
      const messages: Message[] = [
        { role: 'system', content: 'System prompt', timestamp: Date.now() },
        { role: 'user', content: 'Hello', timestamp: Date.now() },
      ];
      const result = await provider.chat(messages, 'claude-3-opus', defaultOptions);
      expect(result).toBeDefined();
    });
  });
});
