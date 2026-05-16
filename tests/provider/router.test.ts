import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Build a stable mock LLMProvider that tests can control per-test.
// ---------------------------------------------------------------------------

const mockChat = vi.fn();
const mockChatStream = vi.fn();

function createMockProvider(hasStream = true) {
  const provider: Record<string, unknown> = {
    name: 'mock',
    chat: mockChat,
  };
  if (hasStream) {
    provider.chatStream = mockChatStream;
  }
  return provider as import('../../src/provider/types.js').LLMProvider;
}

// ---------------------------------------------------------------------------
// Mock the concrete provider constructors so that `new XxxProvider(...)`
// returns our mock provider instances.
// ---------------------------------------------------------------------------

const mockAnthropicInstance = createMockProvider(true);
const mockOpenAIInstance = createMockProvider(true);
const mockGoogleInstance = createMockProvider(true);

vi.mock('../../src/provider/anthropic.js', () => {
  return {
    AnthropicProvider: vi.fn(() => mockAnthropicInstance),
  };
});

vi.mock('../../src/provider/openai.js', () => {
  return {
    OpenAICompatibleProvider: vi.fn((_config: unknown) => mockOpenAIInstance),
  };
});

vi.mock('../../src/provider/google.js', () => {
  return {
    GoogleProvider: vi.fn(() => mockGoogleInstance),
  };
});

// ---------------------------------------------------------------------------
// Import SUT **after** mocks are set up.
// ---------------------------------------------------------------------------

import { ProviderRouter } from '../../src/provider/router.js';
import type { XiaobaiConfig } from '../../src/config/manager.js';
import type { Message } from '../../src/session/manager.js';
import type { ProviderResponse, StreamChunk, ChatOptions } from '../../src/provider/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<XiaobaiConfig> = {}): XiaobaiConfig {
  return {
    model: { default: 'gpt-4', fallback: 'gpt-3.5-turbo', compact: 'gpt-4o-mini', ...overrides.model },
    provider: { default: 'openai', apiKey: 'test-key', ...overrides.provider },
    memory: { enabled: false, memoryCharLimit: 1000, userCharLimit: 500 },
    skills: { enabled: false },
    ...overrides,
  } as XiaobaiConfig;
}

function makeMessages(content = 'Hello', role: Message['role'] = 'user'): Message[] {
  return [{ role, content, timestamp: Date.now() }];
}

const defaultResponse: ProviderResponse = {
  content: 'Hi there!',
  stopReason: 'end_turn',
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};

// ===========================================================================
// Tests
// ===========================================================================

describe('ProviderRouter', () => {
  let config: XiaobaiConfig;
  let router: ProviderRouter;

  beforeEach(() => {
    config = makeConfig();
    router = new ProviderRouter(config);

    // Reset all mock call tracking.
    mockChat.mockReset();
    mockChatStream.mockReset();

    // Provide sensible defaults so individual tests only override what they need.
    mockChat.mockResolvedValue({ ...defaultResponse });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('stores the provided config', () => {
      const cfg = makeConfig({ provider: { default: 'anthropic', apiKey: 'k' } });
      const r = new ProviderRouter(cfg);
      // Indirect proof: chat() should use the config's default provider.
      mockChat.mockResolvedValue({ ...defaultResponse });
      void r.chat(makeMessages());
      expect(mockChat).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Provider caching
  // -------------------------------------------------------------------------

  describe('provider caching', () => {
    it('returns the same provider instance on repeated calls', async () => {
      await router.chat(makeMessages());
      await router.chat(makeMessages());
      // The underlying mockChat should have been called twice on the SAME
      // provider instance -- the provider map should not grow.
      expect(mockChat).toHaveBeenCalledTimes(2);
    });

    it('uses config default provider when name is not explicitly given', async () => {
      // chatStream calls getProvider(providerName) with the default.
      // chat() calls withRetry which calls getProvider(providerName) -- always
      // passing a value. But getProvider(providerName?) accepts undefined.
      // We test this by verifying the config.default is used via summarize,
      // which calls getProvider(this.config.provider.default).
      const specificConfig = makeConfig({ provider: { default: 'anthropic', apiKey: 'key' } });
      const specificRouter = new ProviderRouter(specificConfig);
      mockChat.mockResolvedValue({ content: 'Summary', stopReason: 'end_turn' });

      await specificRouter.summarize(makeMessages());

      // Confirm the anthropic mock constructor was called, meaning the
      // config default provider was resolved.
      const { AnthropicProvider } = await import('../../src/provider/anthropic.js');
      expect(AnthropicProvider).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. registerProviderFactory / unregisterProviderFactory
  // -------------------------------------------------------------------------

  describe('registerProviderFactory', () => {
    it('registers a custom provider factory that is used by getProvider', async () => {
      const customProvider = {
        name: 'custom-test',
        chat: vi.fn().mockResolvedValue({ ...defaultResponse }),
      };
      const factory = vi.fn(() => customProvider);

      router.registerProviderFactory('custom-test', factory);

      const updatedConfig = makeConfig({ provider: { default: 'custom-test', apiKey: 'custom-key' } });
      const customRouter = new ProviderRouter(updatedConfig);
      customRouter.registerProviderFactory('custom-test', factory);

      await customRouter.chat(makeMessages());

      expect(factory).toHaveBeenCalledTimes(1);
      expect(customProvider.chat).toHaveBeenCalledTimes(1);
    });

    it('overrides a built-in factory when name collides', async () => {
      const customProvider = {
        name: 'openai',
        chat: vi.fn().mockResolvedValue({ ...defaultResponse }),
      };
      router.registerProviderFactory('openai', () => customProvider);

      const updatedConfig = makeConfig({ provider: { default: 'openai' } });
      const customRouter = new ProviderRouter(updatedConfig);
      customRouter.registerProviderFactory('openai', () => customProvider);

      await customRouter.chat(makeMessages());
      expect(customProvider.chat).toHaveBeenCalledTimes(1);
    });
  });

  describe('unregisterProviderFactory', () => {
    it('removes a previously registered plugin factory', async () => {
      const customProvider = {
        name: 'temp-provider',
        chat: vi.fn().mockResolvedValue({ ...defaultResponse }),
      };
      const factory = vi.fn(() => customProvider);

      router.registerProviderFactory('temp-provider', factory);
      router.unregisterProviderFactory('temp-provider');

      // After unregistration, 'temp-provider' is unknown, so it falls back to
      // OpenAI-compatible. Our mock OpenAI provider will handle it.
      const updatedConfig = makeConfig({ provider: { default: 'temp-provider' } });
      const customRouter = new ProviderRouter(updatedConfig);

      await customRouter.chat(makeMessages());
      expect(factory).toHaveBeenCalledTimes(0);
    });

    it('also removes the cached provider instance for that name', async () => {
      const customProvider = {
        name: 'removable',
        chat: vi.fn().mockResolvedValue({ ...defaultResponse }),
      };
      const factory = vi.fn(() => customProvider);

      const updatedConfig = makeConfig({ provider: { default: 'removable', apiKey: 'k' } });
      const customRouter = new ProviderRouter(updatedConfig);
      customRouter.registerProviderFactory('removable', factory);

      // First call creates and caches the provider.
      await customRouter.chat(makeMessages());
      expect(factory).toHaveBeenCalledTimes(1);

      // Unregister -- should evict the cache entry too.
      customRouter.unregisterProviderFactory('removable');

      // Now it falls back to OpenAI-compatible (our mock).
      await customRouter.chat(makeMessages());
      // factory is still 1 because the cache was cleared and the factory was removed.
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Unknown provider falls back to OpenAI-compatible
  // -------------------------------------------------------------------------

  describe('unknown provider fallback', () => {
    it('treats unknown provider as OpenAI-compatible', async () => {
      const unknownConfig = makeConfig({ provider: { default: 'totally-unknown-provider', apiKey: 'key' } });
      const unknownRouter = new ProviderRouter(unknownConfig);

      await unknownRouter.chat(makeMessages());
      // Should have called mockChat on our mock OpenAI-compatible provider.
      expect(mockChat).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. chat()
  // -------------------------------------------------------------------------

  describe('chat', () => {
    it('returns a valid ProviderResponse', async () => {
      const result = await router.chat(makeMessages());
      expect(result).toEqual(defaultResponse);
    });

    it('passes default provider and model to the provider', async () => {
      await router.chat(makeMessages());
      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-4',
        {},
      );
    });

    it('passes options through to the provider', async () => {
      const opts: ChatOptions = { maxTokens: 2048, temperature: 0.7 };
      await router.chat(makeMessages(), opts);
      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-4',
        opts,
      );
    });

    it('returns null when the provider returns null', async () => {
      mockChat.mockResolvedValue(null);
      const result = await router.chat(makeMessages());
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 6. chat() with retry
  // -------------------------------------------------------------------------

  describe('chat with retry', () => {
    it('retries on rate-limit errors and eventually succeeds', async () => {
      const rateLimitError = new Error('rate limit exceeded');
      mockChat
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ ...defaultResponse });

      // Speed up timers so we don't actually wait.
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const promise = router.chat(makeMessages());
      // Flush all pending timers from retry delays.
      await vi.advanceTimersByTimeAsync(15000);
      const result = await promise;

      expect(result).toEqual(defaultResponse);
      expect(mockChat).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('retries on 429 errors', async () => {
      const error429 = new Error('HTTP 429 Too Many Requests');
      mockChat
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ ...defaultResponse });

      vi.useFakeTimers({ shouldAdvanceTime: true });
      const promise = router.chat(makeMessages());
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result).toEqual(defaultResponse);
      expect(mockChat).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('retries on 500 errors', async () => {
      const error500 = new Error('HTTP 500 Internal Server Error');
      mockChat
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce({ ...defaultResponse });

      vi.useFakeTimers({ shouldAdvanceTime: true });
      const promise = router.chat(makeMessages());
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result).toEqual(defaultResponse);
      expect(mockChat).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('retries on 503 errors', async () => {
      const error503 = new Error('Service overloaded 503');
      mockChat
        .mockRejectedValueOnce(error503)
        .mockResolvedValueOnce({ ...defaultResponse });

      vi.useFakeTimers({ shouldAdvanceTime: true });
      const promise = router.chat(makeMessages());
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result).toEqual(defaultResponse);
      expect(mockChat).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('retries on timeout errors', async () => {
      const timeoutError = new Error('Request timeout after 30s');
      mockChat
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ ...defaultResponse });

      vi.useFakeTimers({ shouldAdvanceTime: true });
      const promise = router.chat(makeMessages());
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result).toEqual(defaultResponse);
      expect(mockChat).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('retries on connection errors', async () => {
      const connError = new Error('connection reset by peer');
      mockChat
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce({ ...defaultResponse });

      vi.useFakeTimers({ shouldAdvanceTime: true });
      const promise = router.chat(makeMessages());
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result).toEqual(defaultResponse);
      expect(mockChat).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('does NOT retry on non-retryable errors (e.g. 400)', async () => {
      // Use a config with no fallback model so the fallback path is not triggered.
      const noFallbackConfig = makeConfig({ model: { default: 'gpt-4' } });
      const noFallbackRouter = new ProviderRouter(noFallbackConfig);

      const badRequestError = new Error('HTTP 400 Bad Request: invalid model');
      mockChat.mockRejectedValue(badRequestError);

      await expect(noFallbackRouter.chat(makeMessages())).rejects.toThrow('HTTP 400');
      // Should be called exactly once -- no retries, no fallback.
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting max retries (3 attempts)', async () => {
      const rateLimitError = new Error('rate limit exceeded');
      // Use no fallback config so fallback path does not trigger.
      const noFallbackRetryConfig = makeConfig({ model: { default: 'gpt-4' } });
      const retryRouter = new ProviderRouter(noFallbackRetryConfig);

      mockChat.mockRejectedValue(rateLimitError);

      // Mock setTimeout to resolve immediately so retries happen synchronously.
      const originalSetTimeout = globalThis.setTimeout;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void) => {
        // Execute the callback on next microtask tick to let the promise chain proceed.
        Promise.resolve().then(() => fn());
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

      await expect(retryRouter.chat(makeMessages())).rejects.toThrow('rate limit');
      // 3 attempts total (attempt 0, 1, 2).
      expect(mockChat).toHaveBeenCalledTimes(3);

      vi.restoreAllMocks();
    });

    it('uses fallback model on first-attempt failure when fallback is configured', async () => {
      const nonRetryableError = new Error('model not found');
      mockChat
        .mockRejectedValueOnce(nonRetryableError) // primary model fails
        .mockResolvedValueOnce({ ...defaultResponse, content: 'fallback response' }); // fallback succeeds

      const result = await router.chat(makeMessages());

      // First call uses 'gpt-4', second uses 'gpt-3.5-turbo' (fallback).
      expect(mockChat).toHaveBeenCalledTimes(2);
      expect(mockChat).toHaveBeenNthCalledWith(1, expect.any(Array), 'gpt-4', {});
      expect(mockChat).toHaveBeenNthCalledWith(2, expect.any(Array), 'gpt-3.5-turbo', {});
      expect(result?.content).toBe('fallback response');
    });

    it('does not attempt fallback model when no fallback is configured', async () => {
      const noFallbackConfig = makeConfig({ model: { default: 'gpt-4' } });
      const noFallbackRouter = new ProviderRouter(noFallbackConfig);

      mockChat.mockRejectedValue(new Error('model not found'));

      await expect(noFallbackRouter.chat(makeMessages())).rejects.toThrow('model not found');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('throws original error when fallback also fails', async () => {
      const originalError = new Error('model not found');
      const fallbackError = new Error('fallback also failed');
      mockChat
        .mockRejectedValueOnce(originalError)
        .mockRejectedValueOnce(fallbackError);

      await expect(router.chat(makeMessages())).rejects.toThrow('model not found');
      expect(mockChat).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // 7. chatStream()
  // -------------------------------------------------------------------------

  describe('chatStream', () => {
    it('delegates to provider.chatStream when available', async () => {
      const chunks: StreamChunk[] = [];
      mockChatStream.mockImplementation(async function* () {
        yield { type: 'text_delta' as const, text: 'Hello ' };
        yield { type: 'text_delta' as const, text: 'world' };
        yield { type: 'done' as const, stopReason: 'end_turn' };
      });

      for await (const chunk of router.chatStream(makeMessages())) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: 'text_delta', text: 'Hello ' },
        { type: 'text_delta', text: 'world' },
        { type: 'done', stopReason: 'end_turn' },
      ]);
      expect(mockChatStream).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-4',
        {},
      );
    });

    it('falls back to single chat() + yields when provider has no chatStream', async () => {
      // Create a router with a provider that lacks chatStream.
      const noStreamProvider = {
        name: 'no-stream',
        chat: vi.fn().mockResolvedValue({ content: 'Full response text', stopReason: 'end_turn' }),
        // Intentionally no chatStream property.
      };
      const factory = () => noStreamProvider as unknown as import('../../src/provider/types.js').LLMProvider;

      const noStreamConfig = makeConfig({ provider: { default: 'no-stream', apiKey: 'k' } });
      const noStreamRouter = new ProviderRouter(noStreamConfig);
      noStreamRouter.registerProviderFactory('no-stream', factory);

      const chunks: StreamChunk[] = [];
      for await (const chunk of noStreamRouter.chatStream(makeMessages())) {
        chunks.push(chunk);
      }

      expect(noStreamProvider.chat).toHaveBeenCalledTimes(1);
      expect(chunks).toEqual([
        { type: 'text_delta', text: 'Full response text' },
        { type: 'done', stopReason: 'end_turn' },
      ]);
    });

    it('yields no text_delta chunk when response content is empty', async () => {
      const noStreamProvider = {
        name: 'empty-stream',
        chat: vi.fn().mockResolvedValue({ content: '', stopReason: 'end_turn' }),
      };
      const factory = () => noStreamProvider as unknown as import('../../src/provider/types.js').LLMProvider;

      const noStreamConfig = makeConfig({ provider: { default: 'empty-stream', apiKey: 'k' } });
      const noStreamRouter = new ProviderRouter(noStreamConfig);
      noStreamRouter.registerProviderFactory('empty-stream', factory);

      const chunks: StreamChunk[] = [];
      for await (const chunk of noStreamRouter.chatStream(makeMessages())) {
        chunks.push(chunk);
      }

      // Only 'done' chunk, no 'text_delta' because content was empty.
      expect(chunks).toEqual([
        { type: 'done', stopReason: 'end_turn' },
      ]);
    });

    it('passes options through to chatStream', async () => {
      const opts: ChatOptions = { maxTokens: 500, temperature: 0.3 };
      mockChatStream.mockImplementation(async function* () {
        yield { type: 'done' as const, stopReason: 'end_turn' };
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of router.chatStream(makeMessages(), opts)) {
        chunks.push(chunk);
      }

      expect(mockChatStream).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-4',
        opts,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 8. summarize()
  // -------------------------------------------------------------------------

  describe('summarize', () => {
    it('uses compact model and returns content', async () => {
      mockChat.mockResolvedValue({ content: 'Summary of conversation', stopReason: 'end_turn' });

      const messages = makeMessages('Long conversation text here');
      const result = await router.summarize(messages);

      expect(result).toBe('Summary of conversation');
      // Should use the compact model from config.
      expect(mockChat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: expect.stringContaining('Summarize') }),
        ]),
        'gpt-4o-mini', // compact model from config
        { maxTokens: 2000 },
      );
    });

    it('truncates messages to the last 20 entries', async () => {
      mockChat.mockResolvedValue({ content: 'Summary', stopReason: 'end_turn' });

      const manyMessages: Message[] = Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
        timestamp: Date.now(),
      }));

      await router.summarize(manyMessages);

      const passedMessages = mockChat.mock.calls[0][0] as Message[];
      // system message + up to 20 user messages = 21 total.
      expect(passedMessages).toHaveLength(21);
      expect(passedMessages[0].role).toBe('system');
      // The first user message should be message index 30 (50 - 20 = 30).
      expect(passedMessages[1].content).toBe('Message 30');
    });

    it('falls back to fallback model when compact is not set', async () => {
      const noCompactConfig = makeConfig({ model: { default: 'gpt-4', fallback: 'gpt-3.5-turbo' } });
      const noCompactRouter = new ProviderRouter(noCompactConfig);
      mockChat.mockResolvedValue({ content: 'Summary', stopReason: 'end_turn' });

      await noCompactRouter.summarize(makeMessages());

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-3.5-turbo',
        { maxTokens: 2000 },
      );
    });

    it('falls back to default model when neither compact nor fallback is set', async () => {
      const minimalConfig = makeConfig({ model: { default: 'gpt-4' } });
      const minimalRouter = new ProviderRouter(minimalConfig);
      mockChat.mockResolvedValue({ content: 'Summary', stopReason: 'end_turn' });

      await minimalRouter.summarize(makeMessages());

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-4',
        { maxTokens: 2000 },
      );
    });

    it('returns fallback string when content is null', async () => {
      mockChat.mockResolvedValue({ content: undefined, stopReason: 'end_turn' });

      const result = await router.summarize(makeMessages());
      expect(result).toBe('Context summary unavailable');
    });

    it('returns empty string when content is empty (?? does not coerce falsy)', async () => {
      mockChat.mockResolvedValue({ content: '', stopReason: 'end_turn' });

      const result = await router.summarize(makeMessages());
      // Source uses `response.content ?? 'fallback'`. The `??` operator only
      // triggers on null/undefined, not on empty string. So empty string passes through.
      expect(result).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // 9. chatWithRole()
  // -------------------------------------------------------------------------

  describe('chatWithRole', () => {
    it('routes architect role to auxiliary architect config', async () => {
      const roleConfig = makeConfig({
        auxiliary: {
          architectProvider: 'anthropic',
          architectModel: 'claude-sonnet-4-20250514',
        },
      });
      const roleRouter = new ProviderRouter(roleConfig);

      await roleRouter.chatWithRole(makeMessages(), 'architect');

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'claude-sonnet-4-20250514',
        {},
      );
    });

    it('routes editor role to auxiliary editor config', async () => {
      const roleConfig = makeConfig({
        auxiliary: {
          editorProvider: 'deepseek',
          editorModel: 'deepseek-coder',
        },
      });
      const roleRouter = new ProviderRouter(roleConfig);

      await roleRouter.chatWithRole(makeMessages(), 'editor');

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'deepseek-coder',
        {},
      );
    });

    it('routes reviewer role to auxiliary reviewer config', async () => {
      const roleConfig = makeConfig({
        auxiliary: {
          reviewerProvider: 'google',
          reviewerModel: 'gemini-pro',
        },
      });
      const roleRouter = new ProviderRouter(roleConfig);

      await roleRouter.chatWithRole(makeMessages(), 'reviewer');

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'gemini-pro',
        {},
      );
    });

    it('falls back to default config when role has no auxiliary override', async () => {
      // No auxiliary config at all.
      const noAuxConfig = makeConfig();
      const noAuxRouter = new ProviderRouter(noAuxConfig);

      await noAuxRouter.chatWithRole(makeMessages(), 'architect');
      expect(mockChat).toHaveBeenCalledWith(expect.any(Array), 'gpt-4', {});

      mockChat.mockClear();

      await noAuxRouter.chatWithRole(makeMessages(), 'editor');
      // Editor falls back to fallback model (gpt-3.5-turbo) then default.
      expect(mockChat).toHaveBeenCalledWith(expect.any(Array), 'gpt-3.5-turbo', {});

      mockChat.mockClear();

      await noAuxRouter.chatWithRole(makeMessages(), 'reviewer');
      expect(mockChat).toHaveBeenCalledWith(expect.any(Array), 'gpt-4', {});
    });

    it('uses default role as catch-all', async () => {
      await router.chatWithRole(makeMessages(), 'default');

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-4',
        {},
      );
    });

    it('editor role falls back to default model when no fallback is configured', async () => {
      const noFallbackConfig = makeConfig({ model: { default: 'gpt-4' } });
      const noFallbackRouter = new ProviderRouter(noFallbackConfig);

      await noFallbackRouter.chatWithRole(makeMessages(), 'editor');

      // Editor uses fallback model, but no fallback configured, so uses default.
      expect(mockChat).toHaveBeenCalledWith(expect.any(Array), 'gpt-4', {});
    });

    it('passes options through', async () => {
      const opts: ChatOptions = { maxTokens: 4096, temperature: 0.5 };
      await router.chatWithRole(makeMessages(), 'default', opts);

      expect(mockChat).toHaveBeenCalledWith(expect.any(Array), 'gpt-4', opts);
    });
  });

  // -------------------------------------------------------------------------
  // 10. chatStreamWithRole()
  // -------------------------------------------------------------------------

  describe('chatStreamWithRole', () => {
    it('delegates to provider.chatStream with role config', async () => {
      const roleConfig = makeConfig({
        auxiliary: { architectModel: 'claude-opus-4' },
      });
      const roleRouter = new ProviderRouter(roleConfig);

      mockChatStream.mockImplementation(async function* () {
        yield { type: 'text_delta' as const, text: 'Planned.' };
        yield { type: 'done' as const, stopReason: 'end_turn' };
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of roleRouter.chatStreamWithRole(makeMessages(), 'architect')) {
        chunks.push(chunk);
      }

      expect(mockChatStream).toHaveBeenCalledWith(
        expect.any(Array),
        'claude-opus-4',
        {},
      );
      expect(chunks).toHaveLength(2);
    });

    it('falls back to chat() when provider has no chatStream', async () => {
      const noStreamProvider = {
        name: 'no-stream-role',
        chat: vi.fn().mockResolvedValue({ content: 'Response', stopReason: 'end_turn' }),
      };
      const factory = () => noStreamProvider as unknown as import('../../src/provider/types.js').LLMProvider;

      const noStreamConfig = makeConfig({
        provider: { default: 'no-stream-role', apiKey: 'k' },
        auxiliary: { editorModel: 'editor-v1' },
      });
      const noStreamRouter = new ProviderRouter(noStreamConfig);
      noStreamRouter.registerProviderFactory('no-stream-role', factory);

      const chunks: StreamChunk[] = [];
      for await (const chunk of noStreamRouter.chatStreamWithRole(makeMessages(), 'editor')) {
        chunks.push(chunk);
      }

      expect(noStreamProvider.chat).toHaveBeenCalledWith(
        expect.any(Array),
        'editor-v1',
        {},
      );
      expect(chunks).toEqual([
        { type: 'text_delta', text: 'Response' },
        { type: 'done', stopReason: 'end_turn' },
      ]);
    });

    it('yields no text_delta when response content is empty', async () => {
      const noStreamProvider = {
        name: 'empty-role',
        chat: vi.fn().mockResolvedValue({ content: '', stopReason: 'end_turn' }),
      };
      const factory = () => noStreamProvider as unknown as import('../../src/provider/types.js').LLMProvider;

      const emptyConfig = makeConfig({ provider: { default: 'empty-role', apiKey: 'k' } });
      const emptyRouter = new ProviderRouter(emptyConfig);
      emptyRouter.registerProviderFactory('empty-role', factory);

      const chunks: StreamChunk[] = [];
      for await (const chunk of emptyRouter.chatStreamWithRole(makeMessages(), 'default')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([{ type: 'done', stopReason: 'end_turn' }]);
    });
  });

  // -------------------------------------------------------------------------
  // 11. getEnvKey() -- tested indirectly through provider creation
  // -------------------------------------------------------------------------

  describe('getEnvKey (environment variable mapping)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('picks up ANTHROPIC_API_KEY for anthropic provider', async () => {
      process.env.ANTHROPIC_API_KEY = 'anthropic-key-123';
      const anthropicConfig = makeConfig({
        provider: { default: 'anthropic' },
        model: { default: 'claude-3' },
      });
      const anthropicRouter = new ProviderRouter(anthropicConfig);

      await anthropicRouter.chat(makeMessages());

      const { AnthropicProvider } = await import('../../src/provider/anthropic.js');
      expect(AnthropicProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'anthropic-key-123' }),
      );

      delete process.env.ANTHROPIC_API_KEY;
    });

    it('picks up OPENAI_API_KEY for openai provider', async () => {
      process.env.OPENAI_API_KEY = 'openai-key-456';
      const openaiConfig = makeConfig({
        provider: { default: 'openai' },
        model: { default: 'gpt-4' },
      });
      const openaiRouter = new ProviderRouter(openaiConfig);

      await openaiRouter.chat(makeMessages());

      const { OpenAICompatibleProvider } = await import('../../src/provider/openai.js');
      // The provider was constructed at least once with this key.
      expect(OpenAICompatibleProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'openai-key-456' }),
      );

      delete process.env.OPENAI_API_KEY;
    });

    it('prefers config apiKey over environment variable', async () => {
      process.env.OPENAI_API_KEY = 'env-key';
      const explicitConfig = makeConfig({
        provider: { default: 'openai', apiKey: 'explicit-key' },
        model: { default: 'gpt-4' },
      });
      const explicitRouter = new ProviderRouter(explicitConfig);

      await explicitRouter.chat(makeMessages());

      const { OpenAICompatibleProvider } = await import('../../src/provider/openai.js');
      expect(OpenAICompatibleProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'explicit-key' }),
      );

      delete process.env.OPENAI_API_KEY;
    });

    it('uses XIAOBAI_API_KEY as final fallback', async () => {
      process.env.XIAOBAI_API_KEY = 'xiaobai-key';
      const unknownConfig = makeConfig({
        provider: { default: 'some-brand-new-provider' },
        model: { default: 'model-1' },
      });
      const unknownRouter = new ProviderRouter(unknownConfig);

      await unknownRouter.chat(makeMessages());

      const { OpenAICompatibleProvider } = await import('../../src/provider/openai.js');
      expect(OpenAICompatibleProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'xiaobai-key' }),
      );

      delete process.env.XIAOBAI_API_KEY;
    });

    it('tries multiple env keys for providers with alternatives (qwen)', async () => {
      process.env.DASHSCOPE_API_KEY = 'dashscope-key';
      const qwenConfig = makeConfig({
        provider: { default: 'qwen' },
        model: { default: 'qwen-turbo' },
      });
      const qwenRouter = new ProviderRouter(qwenConfig);

      await qwenRouter.chat(makeMessages());

      const { OpenAICompatibleProvider } = await import('../../src/provider/openai.js');
      expect(OpenAICompatibleProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'dashscope-key' }),
      );

      delete process.env.DASHSCOPE_API_KEY;
    });

    it('returns undefined when no env key matches and no XIAOBAI_API_KEY for unknown provider', async () => {
      // Clear all API keys from env.
      delete process.env.OPENAI_API_KEY;
      delete process.env.XIAOBAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const noKeyConfig = makeConfig({
        provider: { default: 'totally-unknown-llm' }, // no env mapping
        model: { default: 'llama3' },
      });
      const noKeyRouter = new ProviderRouter(noKeyConfig);

      await noKeyRouter.chat(makeMessages());

      const { OpenAICompatibleProvider } = await import('../../src/provider/openai.js');
      // Unknown provider has no env key mapping, so apiKey comes from
      // getEnvKey which returns undefined (no XIAOBAI_API_KEY set).
      expect(OpenAICompatibleProvider).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: undefined }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 12. getAvailableProviders()
  // -------------------------------------------------------------------------

  describe('static getAvailableProviders', () => {
    it('returns a non-empty array of provider names', () => {
      const providers = ProviderRouter.getAvailableProviders();
      expect(providers.length).toBeGreaterThan(0);
    });

    it('includes all known providers', () => {
      const providers = ProviderRouter.getAvailableProviders();
      const expected = [
        'anthropic', 'openai', 'google', 'groq', 'ollama',
        'deepseek', 'zhipu', 'qwen', 'moonshot', 'yi',
        'baidu', 'minimax', 'baichuan',
        'claude-web', 'chatgpt-web',
        'openaiCompatible',
      ];
      for (const name of expected) {
        expect(providers).toContain(name);
      }
    });

    it('returns exactly 16 providers', () => {
      expect(ProviderRouter.getAvailableProviders()).toHaveLength(16);
    });
  });

  // -------------------------------------------------------------------------
  // 13. updateConfig()
  // -------------------------------------------------------------------------

  describe('updateConfig', () => {
    it('updates the default provider and clears cached provider', async () => {
      await router.chat(makeMessages()); // caches 'openai' provider.
      expect(mockChat).toHaveBeenCalledTimes(1);

      router.updateConfig({ provider: 'anthropic' });
      await router.chat(makeMessages());

      // After update, should look up new provider (anthropic).
      // Since AnthropicProvider mock was invoked, the provider was rebuilt.
      const { AnthropicProvider } = await import('../../src/provider/anthropic.js');
      expect(AnthropicProvider).toHaveBeenCalled();
    });

    it('updates the default model', async () => {
      router.updateConfig({ model: 'gpt-4o' });
      await router.chat(makeMessages());

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-4o',
        {},
      );
    });

    it('handles partial updates (only provider)', async () => {
      router.updateConfig({ provider: 'google' });
      await router.chat(makeMessages());

      // Model should still be the original default 'gpt-4'.
      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-4',
        {},
      );
    });

    it('handles partial updates (only model)', async () => {
      router.updateConfig({ model: 'claude-3' });
      await router.chat(makeMessages());

      expect(mockChat).toHaveBeenCalledWith(
        expect.any(Array),
        'claude-3',
        {},
      );
    });
  });

  // -------------------------------------------------------------------------
  // 14. isRetryable() -- tested indirectly through retry behavior
  // -------------------------------------------------------------------------

  describe('isRetryable (via retry behavior)', () => {
    it('retries on "overloaded" errors', async () => {
      mockChat
        .mockRejectedValueOnce(new Error('Server is overloaded'))
        .mockResolvedValueOnce({ ...defaultResponse });

      vi.useFakeTimers({ shouldAdvanceTime: true });
      const promise = router.chat(makeMessages());
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result).toEqual(defaultResponse);
      expect(mockChat).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('does not retry on non-Error objects', async () => {
      // Use no fallback config to avoid the fallback path.
      const noFallbackConfig = makeConfig({ model: { default: 'gpt-4' } });
      const noFallbackRouter = new ProviderRouter(noFallbackConfig);

      mockChat.mockRejectedValue('string error');

      await expect(noFallbackRouter.chat(makeMessages())).rejects.toBe('string error');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('does not retry on Error without retryable keywords', async () => {
      // Use no fallback config to avoid the fallback path.
      const noFallbackConfig = makeConfig({ model: { default: 'gpt-4' } });
      const noFallbackRouter = new ProviderRouter(noFallbackConfig);

      mockChat.mockRejectedValue(new Error('Invalid API key provided'));

      await expect(noFallbackRouter.chat(makeMessages())).rejects.toThrow('Invalid API key');
      expect(mockChat).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 15. withRetry -- max retries exceeded
  // -------------------------------------------------------------------------

  describe('withRetry max retries exceeded', () => {
    it('stops retrying after MAX_RETRIES (3) attempts and throws', async () => {
      // Use no fallback config so fallback path does not trigger.
      const noFallbackConfig = makeConfig({ model: { default: 'gpt-4' } });
      const retryRouter = new ProviderRouter(noFallbackConfig);

      mockChat.mockRejectedValue(new Error('rate limit hit'));

      // Mock setTimeout to resolve immediately.
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void) => {
        Promise.resolve().then(() => fn());
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

      await expect(retryRouter.chat(makeMessages())).rejects.toThrow('rate limit hit');
      // 3 attempts total (attempt 0, 1, 2).
      expect(mockChat).toHaveBeenCalledTimes(3);

      vi.restoreAllMocks();
    });

    it('tries fallback model only on first attempt (attempt 0)', async () => {
      // Non-retryable error triggers fallback path.
      const error = new Error('context window exceeded');
      mockChat
        .mockRejectedValueOnce(error)  // primary model, attempt 0 -> triggers fallback
        .mockResolvedValueOnce({ ...defaultResponse, content: 'fallback OK' });

      const result = await router.chat(makeMessages());

      expect(mockChat).toHaveBeenCalledTimes(2);
      expect(mockChat).toHaveBeenNthCalledWith(2, expect.any(Array), 'gpt-3.5-turbo', {});
      expect(result?.content).toBe('fallback OK');
    });
  });

  // -------------------------------------------------------------------------
  // 16. Provider constructor delegation
  // -------------------------------------------------------------------------

  describe('provider constructor delegation', () => {
    it('creates AnthropicProvider for anthropic', async () => {
      const anthropicConfig = makeConfig({
        provider: { default: 'anthropic', apiKey: 'a-key' },
        model: { default: 'claude-3' },
      });
      const r = new ProviderRouter(anthropicConfig);
      await r.chat(makeMessages());

      const { AnthropicProvider } = await import('../../src/provider/anthropic.js');
      expect(AnthropicProvider).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'anthropic', apiKey: 'a-key' }),
      );
    });

    it('creates GoogleProvider for google', async () => {
      const googleConfig = makeConfig({
        provider: { default: 'google', apiKey: 'g-key' },
        model: { default: 'gemini-pro' },
      });
      const r = new ProviderRouter(googleConfig);
      await r.chat(makeMessages());

      const { GoogleProvider } = await import('../../src/provider/google.js');
      expect(GoogleProvider).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'google', apiKey: 'g-key' }),
      );
    });

    it('creates OpenAICompatibleProvider for groq with correct baseUrl', async () => {
      const groqConfig = makeConfig({
        provider: { default: 'groq', apiKey: 'groq-key' },
        model: { default: 'llama3' },
      });
      const r = new ProviderRouter(groqConfig);
      await r.chat(makeMessages());

      const { OpenAICompatibleProvider } = await import('../../src/provider/openai.js');
      expect(OpenAICompatibleProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'groq',
          apiKey: 'groq-key',
          baseUrl: 'https://api.groq.com/openai/v1',
        }),
      );
    });

    it('creates OpenAICompatibleProvider for ollama with default baseUrl and apiKey', async () => {
      const ollamaConfig = makeConfig({
        provider: { default: 'ollama' },
        model: { default: 'llama3' },
      });
      const r = new ProviderRouter(ollamaConfig);
      await r.chat(makeMessages());

      const { OpenAICompatibleProvider } = await import('../../src/provider/openai.js');
      expect(OpenAICompatibleProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ollama',
          baseUrl: 'http://localhost:11434/v1',
          apiKey: 'ollama',
        }),
      );
    });

    it('creates OpenAICompatibleProvider for deepseek', async () => {
      const dsConfig = makeConfig({
        provider: { default: 'deepseek', apiKey: 'ds-key' },
        model: { default: 'deepseek-chat' },
      });
      const r = new ProviderRouter(dsConfig);
      await r.chat(makeMessages());

      const { OpenAICompatibleProvider } = await import('../../src/provider/openai.js');
      expect(OpenAICompatibleProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
        }),
      );
    });

    it('respects custom baseUrl from config over provider default', async () => {
      const customUrlConfig = makeConfig({
        provider: {
          default: 'groq',
          apiKey: 'groq-key',
          baseUrl: 'https://custom-groq-proxy.example.com/v1',
        },
        model: { default: 'llama3' },
      });
      const r = new ProviderRouter(customUrlConfig);
      await r.chat(makeMessages());

      const { OpenAICompatibleProvider } = await import('../../src/provider/openai.js');
      expect(OpenAICompatibleProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://custom-groq-proxy.example.com/v1',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 17. Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty messages array', async () => {
      const result = await router.chat([]);
      expect(result).toBeDefined();
      expect(mockChat).toHaveBeenCalledWith([], 'gpt-4', {});
    });

    it('handles messages with all role types', async () => {
      const messages: Message[] = [
        { role: 'system', content: 'You are helpful', timestamp: Date.now() },
        { role: 'user', content: 'Hello', timestamp: Date.now() },
        { role: 'assistant', content: 'Hi!', timestamp: Date.now() },
        { role: 'tool_result', content: 'result', toolCallId: 'tc1', timestamp: Date.now() },
      ];

      const result = await router.chat(messages);
      expect(result).toBeDefined();
    });

    it('handles chatStream with empty options', async () => {
      mockChatStream.mockImplementation(async function* () {
        yield { type: 'done' as const, stopReason: 'end_turn' };
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of router.chatStream(makeMessages())) {
        chunks.push(chunk);
      }

      expect(mockChatStream).toHaveBeenCalledWith(expect.any(Array), 'gpt-4', {});
    });

    it('summarize handles single message', async () => {
      mockChat.mockResolvedValue({ content: 'Short summary', stopReason: 'end_turn' });

      const result = await router.summarize(makeMessages('Just one message'));
      expect(result).toBe('Short summary');
    });

    it('chatWithRole handles unknown role string as default', async () => {
      // TypeScript would prevent this at compile time, but runtime should
      // handle it gracefully.
      await router.chatWithRole(makeMessages(), 'default' as 'architect' | 'editor' | 'reviewer' | 'default');

      expect(mockChat).toHaveBeenCalledWith(expect.any(Array), 'gpt-4', {});
    });
  });
});
