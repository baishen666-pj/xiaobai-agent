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

    it('yields tool_call events', async () => {
      const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
      const instance = new MockAnthropic();
      instance.messages.stream.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tc_1', name: 'read_file' } };
          yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file":' } };
          yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '"/test"}' } };
          yield { type: 'message_delta', usage: { output_tokens: 20 }, delta: { stop_reason: 'tool_use' } };
        },
      });

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream!(makeMessages(), 'claude-3-opus', defaultOptions)) {
        chunks.push(chunk);
      }
      expect(chunks.some((c) => c.type === 'tool_call_start')).toBe(true);
      expect(chunks.some((c) => c.type === 'tool_call_delta')).toBe(true);
      expect(chunks.some((c) => c.type === 'done')).toBe(true);
    });

    it('handles message_start without usage', async () => {
      const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
      const instance = new MockAnthropic();
      instance.messages.stream.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: {} };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'test' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
        },
      });

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream!(makeMessages(), 'claude-3-opus', defaultOptions)) {
        chunks.push(chunk);
      }
      expect(chunks.some((c) => c.type === 'text_delta')).toBe(true);
    });

    it('handles message_delta without usage', async () => {
      const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
      const instance = new MockAnthropic();
      instance.messages.stream.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: { usage: { input_tokens: 5 } } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
        },
      });

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream!(makeMessages(), 'claude-3-opus', defaultOptions)) {
        chunks.push(chunk);
      }
      expect(chunks.some((c) => c.type === 'done')).toBe(true);
    });

    it('passes tools and tool_choice to stream', async () => {
      const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
      const instance = new MockAnthropic();
      instance.messages.stream.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
        },
      });

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream!(makeMessages(), 'claude-3-opus', {
        ...defaultOptions,
        tools: [{ name: 'read', description: 'Read', parameters: { type: 'object', properties: {} } }],
        tool_choice: { type: 'auto' },
      })) {
        chunks.push(chunk);
      }
      expect(instance.messages.stream).toHaveBeenCalledWith(
        expect.objectContaining({ tool_choice: { type: 'auto' } }),
        expect.anything(),
      );
    });

    it('works without maxTokens and system', async () => {
      const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
      const instance = new MockAnthropic();
      instance.messages.stream.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
        },
      });

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream!(makeMessages(), 'claude-3-opus', {
        tools: [],
      })) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('handles tool_result messages in stream formatMessages', async () => {
      const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
      const instance = new MockAnthropic();
      instance.messages.stream.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
        },
      });

      const messages: Message[] = [
        { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'read', arguments: {} }], timestamp: Date.now() },
        { role: 'tool_result', toolCallId: 'tc1', content: 'result', timestamp: Date.now() },
      ];

      const chunks: any[] = [];
      for await (const chunk of provider.chatStream!(messages, 'claude-3-opus', defaultOptions)) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
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

    it('handles tool_result after non-assistant message', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'hi', timestamp: Date.now() },
        { role: 'tool_result', toolCallId: 'tc1', content: 'result', timestamp: Date.now() },
      ];
      const result = await provider.chat(messages, 'claude-3-opus', defaultOptions);
      expect(result).toBeDefined();
    });

    it('handles assistant with toolCalls and content', async () => {
      const messages: Message[] = [
        { role: 'assistant', content: 'Thinking...', toolCalls: [{ id: 'tc1', name: 'read', arguments: { path: '/a' } }], timestamp: Date.now() },
      ];
      const result = await provider.chat(messages, 'claude-3-opus', defaultOptions);
      expect(result).toBeDefined();
    });

    it('handles assistant without toolCalls', async () => {
      const messages: Message[] = [
        { role: 'assistant', content: 'Just text', timestamp: Date.now() },
      ];
      const result = await provider.chat(messages, 'claude-3-opus', defaultOptions);
      expect(result).toBeDefined();
    });

    it('handles tool_result appended to assistant with toolCalls', async () => {
      const messages: Message[] = [
        { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'read', arguments: {} }], timestamp: Date.now() },
        { role: 'tool_result', toolCallId: 'tc1', content: 'data', timestamp: Date.now() },
      ];
      const result = await provider.chat(messages, 'claude-3-opus', defaultOptions);
      expect(result).toBeDefined();
    });

    it('handles no text in response content', async () => {
      const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
      const instance = new MockAnthropic();
      instance.messages.create.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tc1', name: 'run', input: { cmd: 'ls' } }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'tool_use',
      });
      const result = await provider.chat(makeMessages(), 'claude-3-opus', defaultOptions);
      expect(result.content).toBeUndefined();
      expect(result.toolCalls).toHaveLength(1);
    });

    it('passes tools and tool_choice to API', async () => {
      const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
      const instance = new MockAnthropic();
      instance.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      const result = await provider.chat(makeMessages(), 'claude-3-opus', {
        ...defaultOptions,
        tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object', properties: {} } }],
        tool_choice: { type: 'auto' },
      });
      expect(result.content).toBe('done');
      expect(instance.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ tool_choice: { type: 'auto' } }),
        expect.anything(),
      );
    });
  });
});
