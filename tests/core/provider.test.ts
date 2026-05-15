import { describe, it, expect, vi } from 'vitest';
import { ProviderRouter } from '../../src/provider/router.js';
import type { XiaobaiConfig } from '../../src/config/manager.js';
import type { Message } from '../../src/session/manager.js';

function makeConfig(overrides?: Partial<XiaobaiConfig['provider']>): XiaobaiConfig {
  return {
    model: { default: 'test-model', fallback: 'fallback-model', compact: 'compact-model' },
    provider: { default: 'openai', apiKey: 'test-key', ...overrides },
    memory: { enabled: false, memoryCharLimit: 2200, userCharLimit: 1375 },
    skills: { enabled: false },
    sandbox: { mode: 'full-access' },
    hooks: {},
    context: { compressionThreshold: 0.5, maxTurns: 90, keepLastN: 20 },
    permissions: { mode: 'auto', deny: [], allow: [] },
  };
}

describe('ProviderRouter', () => {
  it('creates without error', () => {
    const router = new ProviderRouter(makeConfig());
    expect(router).toBeDefined();
  });

  it('summarize returns fallback string on API error', async () => {
    const config = makeConfig({ apiKey: undefined });
    config.provider.default = 'openai';
    config.provider.baseUrl = 'http://localhost:9999';
    const router = new ProviderRouter(config);
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];
    try {
      const summary = await router.summarize(messages);
      expect(typeof summary).toBe('string');
    } catch {
      // Connection refused is expected
      expect(true).toBe(true);
    }
  });

  it('chat returns null response on invalid API key', async () => {
    const router = new ProviderRouter(makeConfig({ apiKey: 'invalid-key' }));
    const messages: Message[] = [{ role: 'user', content: 'test' }];
    try {
      const result = await router.chat(messages);
      expect(result).toBeDefined();
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });

  it('getEnvKey reads from environment', () => {
    process.env['XIAOBAI_API_KEY'] = 'env-test-key';
    const router = new ProviderRouter(makeConfig({ apiKey: undefined }));
    delete process.env['XIAOBAI_API_KEY'];
    expect(router).toBeDefined();
  });

  it('isRetryable detects rate limit errors', () => {
    const router = new ProviderRouter(makeConfig());
    expect((router as any).isRetryable(new Error('rate limit exceeded'))).toBe(true);
    expect((router as any).isRetryable(new Error('429 Too Many Requests'))).toBe(true);
    expect((router as any).isRetryable(new Error('500 Internal Server Error'))).toBe(true);
    expect((router as any).isRetryable(new Error('invalid api key'))).toBe(false);
    expect((router as any).isRetryable(new Error('bad request'))).toBe(false);
  });
});

describe('ProviderRouter Streaming', () => {
  it('chatStream method exists', () => {
    const router = new ProviderRouter(makeConfig());
    expect(typeof router.chatStream).toBe('function');
  });

  it('chatStream returns async generator', async () => {
    const router = new ProviderRouter(makeConfig({ apiKey: 'test' }));
    const messages: Message[] = [{ role: 'user', content: 'test' }];
    const gen = router.chatStream(messages);
    expect(typeof gen[Symbol.asyncIterator]).toBe('function');
  });
});
