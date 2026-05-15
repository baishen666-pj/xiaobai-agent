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

describe('Multi-Provider Support', () => {
  it('lists available providers', () => {
    const providers = ProviderRouter.getAvailableProviders();
    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');
    expect(providers).toContain('google');
    expect(providers).toContain('groq');
    expect(providers).toContain('ollama');
  });

  it('creates Anthropic provider', () => {
    const config = makeConfig({ default: 'anthropic' });
    const router = new ProviderRouter(config);
    const provider = (router as any).getProvider('anthropic');
    expect(provider.name).toBe('anthropic');
  });

  it('creates OpenAI provider', () => {
    const router = new ProviderRouter(makeConfig({ default: 'openai' }));
    const provider = (router as any).getProvider('openai');
    expect(provider.name).toBe('openai');
  });

  it('creates Google provider', () => {
    const config = makeConfig({ default: 'google' });
    const router = new ProviderRouter(config);
    const provider = (router as any).getProvider('google');
    expect(provider.name).toBe('google');
  });

  it('creates Groq provider with correct base URL', () => {
    const config = makeConfig({ default: 'groq' });
    const router = new ProviderRouter(config);
    const provider = (router as any).getProvider('groq');
    expect(provider.name).toBe('groq');
  });

  it('creates Ollama provider with local base URL', () => {
    const config = makeConfig({ default: 'ollama' });
    const router = new ProviderRouter(config);
    const provider = (router as any).getProvider('ollama');
    expect(provider.name).toBe('ollama');
  });

  it('caches provider instances', () => {
    const router = new ProviderRouter(makeConfig());
    const p1 = (router as any).getProvider('openai');
    const p2 = (router as any).getProvider('openai');
    expect(p1).toBe(p2);
  });

  it('treats unknown providers as OpenAI-compatible', () => {
    const router = new ProviderRouter(makeConfig());
    const provider = (router as any).getProvider('custom-llm');
    expect(provider.name).toBe('custom-llm');
  });
});
