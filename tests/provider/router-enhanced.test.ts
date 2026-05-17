import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderRouter } from '../../src/provider/router.js';
import { RateLimiter } from '../../src/provider/rate-limiter.js';
import { ProviderMetrics } from '../../src/provider/provider-metrics.js';
import type { XiaobaiConfig } from '../../src/config/manager.js';
import type { LLMProvider, ProviderResponse } from '../../src/provider/types.js';

function makeConfig(overrides: Partial<XiaobaiConfig> = {}): XiaobaiConfig {
  return {
    model: { default: 'test-model', fallback: 'test-fallback' },
    provider: { default: 'mock' },
    memory: { enabled: false, memoryCharLimit: 2200, userCharLimit: 1375 },
    skills: { enabled: false },
    sandbox: { mode: 'workspace-write' },
    hooks: {},
    context: { compressionThreshold: 0.5, maxTurns: 90, keepLastN: 20 },
    permissions: { mode: 'default', deny: [], allow: [] },
    plugins: { enabled: false },
    ...overrides,
  } as XiaobaiConfig;
}

function makeProvider(response: Partial<ProviderResponse> = {}): LLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: 'mock response',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      ...response,
    }),
  };
}

describe('ProviderRouter with Circuit Breaker', () => {
  it('uses circuit breaker when provided', async () => {
    const metrics = new ProviderMetrics();
    const config = makeConfig();
    const router = new ProviderRouter(config, { circuitBreakerConfig: { failureThreshold: 2, resetTimeoutMs: 1000 }, metrics });

    const mockProvider = makeProvider();
    router.registerProviderFactory('mock', () => mockProvider);

    const result = await router.chat([{ role: 'user', content: 'test' }]);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('mock response');
    expect(metrics.getEntryCount()).toBe(1);
  });

  it('falls back when circuit breaker is open', async () => {
    const config = makeConfig({
      model: { default: 'test-model' },
      provider: {
        default: 'primary',
        fallbacks: [{ name: 'fallback', apiKey: 'test' }],
      },
    } as Partial<XiaobaiConfig>);

    const router = new ProviderRouter(config, { circuitBreakerConfig: { failureThreshold: 1, resetTimeoutMs: 10000 } });

    const fallbackProvider = makeProvider({ content: 'fallback response' });
    router.registerProviderFactory('fallback', () => fallbackProvider);

    const primaryProvider: LLMProvider = {
      name: 'primary',
      chat: vi.fn().mockRejectedValue(new Error('rate limit exceeded')),
    };
    router.registerProviderFactory('primary', () => primaryProvider);

    // First call: primary fails with retryable error, retries exhaust (MAX_RETRIES=3),
    // circuit breaker trips after first failure (failureThreshold: 1),
    // no fallback model configured, cross-provider fallback succeeds
    const result1 = await router.chat([{ role: 'user', content: 'test' }]);
    expect(result1).not.toBeNull();
    expect(result1!.content).toBe('fallback response');

    // Second call: primary's circuit breaker is open, goes directly to fallback
    vi.clearAllMocks();
    const result2 = await router.chat([{ role: 'user', content: 'test' }]);
    expect(result2).not.toBeNull();
    expect(result2!.content).toBe('fallback response');
    // Primary should not have been called on second attempt (circuit breaker is open)
    expect(primaryProvider.chat).not.toHaveBeenCalled();
  });
});

describe('ProviderRouter with Rate Limiter', () => {
  it('respects rate limiter', async () => {
    const limiter = new RateLimiter({ maxTokens: 2, refillRate: 100, perProvider: true });
    const config = makeConfig();
    const router = new ProviderRouter(config, { rateLimiter: limiter });

    const provider = makeProvider();
    router.registerProviderFactory('mock', () => provider);

    await router.chat([{ role: 'user', content: 'first' }]);
    await router.chat([{ role: 'user', content: 'second' }]);

    // Third call should hit rate limit
    expect(limiter.acquire('mock')).toBe(false);
  });
});

describe('ProviderRouter with Metrics', () => {
  it('records metrics on successful call', async () => {
    const metrics = new ProviderMetrics();
    const config = makeConfig();
    const router = new ProviderRouter(config, { metrics });

    router.registerProviderFactory('mock', () => makeProvider());

    await router.chat([{ role: 'user', content: 'test' }]);

    const summary = metrics.getSummary('mock');
    expect(summary).not.toBeNull();
    expect(summary!.requestCount).toBe(1);
    expect(summary!.errorRate).toBe(0);
  });

  it('records metrics on failed call', async () => {
    const metrics = new ProviderMetrics();
    const config = makeConfig();
    const router = new ProviderRouter(config, { metrics });

    const failingProvider: LLMProvider = {
      name: 'mock',
      chat: vi.fn().mockRejectedValue(new Error('API error')),
    };
    router.registerProviderFactory('mock', () => failingProvider);

    await expect(router.chat([{ role: 'user', content: 'test' }])).rejects.toThrow();

    const summary = metrics.getSummary('mock');
    expect(summary!.errorRate).toBeGreaterThan(0);
  });
});

describe('ProviderRouter backward compatibility', () => {
  it('works without circuit breaker, rate limiter, or metrics', async () => {
    const config = makeConfig();
    const router = new ProviderRouter(config);

    router.registerProviderFactory('mock', () => makeProvider());

    const result = await router.chat([{ role: 'user', content: 'test' }]);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('mock response');
  });

  it('works with only some options', async () => {
    const metrics = new ProviderMetrics();
    const config = makeConfig();
    const router = new ProviderRouter(config, { metrics });

    router.registerProviderFactory('mock', () => makeProvider());

    const result = await router.chat([{ role: 'user', content: 'test' }]);
    expect(result).not.toBeNull();
    expect(metrics.getEntryCount()).toBe(1);
  });
});
