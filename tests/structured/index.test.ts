import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { structuredChat, StructuredOutputError } from '../../src/structured/index.js';
import type { Message } from '../../src/session/manager.js';
import type { ChatOptions, ProviderResponse } from '../../src/provider/types.js';
import type { StructuredOutputConfig } from '../../src/structured/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<StructuredOutputConfig> = {}): StructuredOutputConfig {
  return {
    schema: z.object({ text: z.string() }),
    mode: 'prompt_based',
    maxRetries: 1,
    ...overrides,
  };
}

const baseMessages: Message[] = [
  { role: 'user', content: 'Tell me something' },
];

// ---------------------------------------------------------------------------
// structuredChat
// ---------------------------------------------------------------------------

describe('structuredChat', () => {
  it('returns parsed result on first successful attempt', async () => {
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn.mockResolvedValue({ content: '{"text":"hello world"}' });

    const result = await structuredChat(chatFn, baseMessages, makeConfig());

    // structuredChat returns StructuredOutputResult directly (not wrapped in success/failure)
    expect(result.data).toEqual({ text: 'hello world' });
    expect(result.retried).toBe(false);
    expect(result.retryCount).toBe(0);
    expect(result.mode).toBe('prompt_based');
    expect(chatFn).toHaveBeenCalledTimes(1);
  });

  it('retries when first response is invalid JSON', async () => {
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn
      .mockResolvedValueOnce({ content: 'not valid json' })
      .mockResolvedValueOnce({ content: '{"text":"recovered"}' });

    const result = await structuredChat(chatFn, baseMessages, makeConfig({ maxRetries: 2 }));

    // The function returns the result directly (not wrapped in success/failure)
    expect(result.data).toEqual({ text: 'recovered' });
    expect(result.retried).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it('throws StructuredOutputError when all retries are exhausted', async () => {
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn.mockResolvedValue({ content: 'always invalid' });

    await expect(
      structuredChat(chatFn, baseMessages, makeConfig({ maxRetries: 1 })),
    ).rejects.toThrow(StructuredOutputError);

    // maxRetries=1 means 2 attempts (initial + 1 retry)
    expect(chatFn).toHaveBeenCalledTimes(2);
  });

  it('throws StructuredOutputError with correct attempt count', async () => {
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn.mockResolvedValue({ content: 'bad' });

    try {
      await structuredChat(chatFn, baseMessages, makeConfig({ maxRetries: 2 }));
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StructuredOutputError);
      const error = err as StructuredOutputError;
      expect(error.attempts).toBe(3); // maxRetries=2 => 3 attempts
      expect(error.message).toContain('3 attempts');
    }
  });

  it('skips null responses and continues retrying', async () => {
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ content: '{"text":"after null"}' });

    const result = await structuredChat(chatFn, baseMessages, makeConfig({ maxRetries: 2 }));

    expect(result.data).toEqual({ text: 'after null' });
    expect(result.retried).toBe(true);
  });

  it('passes adapted chat options to chatFn', async () => {
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn.mockResolvedValue({ content: '{"text":"ok"}' });

    await structuredChat(chatFn, baseMessages, makeConfig({ mode: 'prompt_based' }));

    const callOptions = chatFn.mock.calls[0][1] as ChatOptions;
    // prompt_based mode should inject system prompt with schema instructions
    expect(callOptions.system).toContain('You must respond with valid JSON');
  });

  it('appends error messages to conversation on retry', async () => {
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn
      .mockResolvedValueOnce({ content: 'invalid' })
      .mockResolvedValueOnce({ content: '{"text":"fixed"}' });

    await structuredChat(chatFn, baseMessages, makeConfig({ maxRetries: 2 }));

    // Second call should have more messages (original + error feedback)
    const secondCallMessages = chatFn.mock.calls[1][0] as Message[];
    expect(secondCallMessages.length).toBeGreaterThan(baseMessages.length);

    // Should include assistant's bad response and user error message
    const lastTwo = secondCallMessages.slice(-2);
    expect(lastTwo[0].role).toBe('assistant');
    expect(lastTwo[1].role).toBe('user');
    expect(lastTwo[1].content).toContain('invalid');
  });

  it('does not mutate the original messages array', async () => {
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn
      .mockResolvedValueOnce({ content: 'bad' })
      .mockResolvedValueOnce({ content: '{"text":"ok"}' });

    const originalLength = baseMessages.length;
    await structuredChat(chatFn, baseMessages, makeConfig({ maxRetries: 2 }));

    expect(baseMessages.length).toBe(originalLength);
  });

  it('uses default maxRetries of 2 when not specified', async () => {
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn.mockResolvedValue({ content: 'always bad' });

    try {
      await structuredChat(chatFn, baseMessages, { schema: z.object({ text: z.string() }) });
    } catch {
      // expected
    }

    // Default maxRetries=2 => 3 attempts
    expect(chatFn).toHaveBeenCalledTimes(3);
  });

  it('handles response with undefined content during retry', async () => {
    // This exercises the `response.content ?? ''` fallback on line 49
    const chatFn = vi.fn<(messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>>();
    chatFn
      .mockResolvedValueOnce({ content: undefined })  // invalid, triggers retry
      .mockResolvedValueOnce({ content: '{"text":"ok"}' });

    const result = await structuredChat(chatFn, baseMessages, makeConfig({ maxRetries: 2 }));

    expect(result.data).toEqual({ text: 'ok' });
    expect(result.retried).toBe(true);

    // Verify the assistant message in the retry was empty string (from ?? '')
    const secondCallMessages = chatFn.mock.calls[1][0] as Message[];
    const assistantMsg = secondCallMessages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe('');
  });
});
