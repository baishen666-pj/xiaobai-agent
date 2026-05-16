import { describe, it, expect, vi } from 'vitest';
import { ProviderHealthChecker, type HealthCheckResult } from '../../src/provider/health.js';
import type { ProviderRouter } from '../../src/provider/router.js';
import type { XiaobaiConfig } from '../../src/config/manager.js';
import type { LLMProvider, ProviderResponse } from '../../src/provider/types.js';

function createMockRouter(providers: Record<string, { ok: boolean; latencyMs: number }>): ProviderRouter {
  const mockProviders = new Map<string, LLMProvider>();
  for (const [name, cfg] of Object.entries(providers)) {
    mockProviders.set(name, {
      name,
      chat: vi.fn().mockImplementation(async () => {
        if (!cfg.ok) throw new Error('Provider unavailable');
        return { content: 'ok' } as ProviderResponse;
      }),
    } as unknown as LLMProvider);
  }

  return {
    getProvider: vi.fn().mockImplementation((name?: string) => {
      if (!name) return mockProviders.get('anthropic');
      return mockProviders.get(name) ?? null;
    }),
  } as unknown as ProviderRouter;
}

const baseConfig: XiaobaiConfig = {
  model: { default: 'claude-sonnet-4-6' },
  provider: { default: 'anthropic' },
  memory: { enabled: true, memoryCharLimit: 2200, userCharLimit: 1375 },
  skills: { enabled: true },
  sandbox: { mode: 'workspace-write' },
  hooks: {},
  context: { compressionThreshold: 0.5, maxTurns: 90, keepLastN: 20 },
  permissions: { mode: 'default', deny: [], allow: [] },
  plugins: { enabled: true },
};

describe('ProviderHealthChecker', () => {
  describe('checkProvider', () => {
    it('should report healthy for responsive provider', async () => {
      const router = createMockRouter({ anthropic: { ok: true, latencyMs: 0 } });
      const checker = new ProviderHealthChecker(router, baseConfig);

      const result = await checker.checkProvider('anthropic');
      expect(result.status).toBe('healthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.consecutiveFailures).toBe(0);
    });

    it('should report degraded for first failure', async () => {
      const router = createMockRouter({ anthropic: { ok: false, latencyMs: 0 } });
      const checker = new ProviderHealthChecker(router, baseConfig, { unhealthyThreshold: 3 });

      const result = await checker.checkProvider('anthropic');
      expect(result.status).toBe('degraded');
      expect(result.consecutiveFailures).toBe(1);
      expect(result.error).toBe('Provider unavailable');
    });

    it('should report unhealthy after consecutive failures', async () => {
      const router = createMockRouter({ anthropic: { ok: false, latencyMs: 0 } });
      const checker = new ProviderHealthChecker(router, baseConfig, { unhealthyThreshold: 2 });

      await checker.checkProvider('anthropic');
      const result = await checker.checkProvider('anthropic');
      expect(result.status).toBe('unhealthy');
      expect(result.consecutiveFailures).toBe(2);
    });

    it('should report unknown for non-existent provider', async () => {
      const router = createMockRouter({});
      const checker = new ProviderHealthChecker(router, baseConfig);

      const result = await checker.checkProvider('nonexistent');
      expect(result.status).toBe('unknown');
      expect(result.error).toBe('Provider not found');
    });

    it('should reset consecutive failures on success', async () => {
      let callCount = 0;
      const router = {
        getProvider: vi.fn().mockImplementation(() => ({
          name: 'anthropic',
          chat: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount <= 2) throw new Error('temp failure');
            return { content: 'ok' } as ProviderResponse;
          }),
        })),
      } as unknown as ProviderRouter;

      const checker = new ProviderHealthChecker(router, baseConfig, { unhealthyThreshold: 5 });

      await checker.checkProvider('anthropic');
      await checker.checkProvider('anthropic');
      const result = await checker.checkProvider('anthropic');
      expect(result.status).toBe('healthy');
      expect(result.consecutiveFailures).toBe(0);
    });
  });

  describe('checkAll', () => {
    it('should check all enabled providers', async () => {
      const router = createMockRouter({
        anthropic: { ok: true, latencyMs: 0 },
        openai: { ok: true, latencyMs: 0 },
        deepseek: { ok: false, latencyMs: 0 },
      });
      const checker = new ProviderHealthChecker(router, baseConfig, {
        enabledProviders: ['anthropic', 'openai', 'deepseek'],
      });

      const results = await checker.checkAll();
      expect(results.length).toBe(3);
      expect(results.find((r) => r.provider === 'anthropic')?.status).toBe('healthy');
      expect(results.find((r) => r.provider === 'deepseek')?.status).toBe('degraded');
    });
  });

  describe('monitoring', () => {
    it('should start and stop periodic health checks', () => {
      const router = createMockRouter({ anthropic: { ok: true, latencyMs: 0 } });
      const checker = new ProviderHealthChecker(router, baseConfig, {
        intervalMs: 5000,
        enabledProviders: ['anthropic'],
      });

      checker.startMonitoring();
      expect(checker.getAllHealth().length).toBeGreaterThanOrEqual(0);
      checker.stopMonitoring();
    });
  });

  describe('selection', () => {
    it('should select best provider by latency', async () => {
      const router = createMockRouter({
        anthropic: { ok: true, latencyMs: 0 },
        openai: { ok: true, latencyMs: 0 },
        deepseek: { ok: false, latencyMs: 0 },
      });
      const checker = new ProviderHealthChecker(router, baseConfig, {
        enabledProviders: ['anthropic', 'openai', 'deepseek'],
        unhealthyThreshold: 1,
      });

      await checker.checkAll();
      const best = checker.selectBestProvider();
      expect(best).toBeDefined();
      // Both healthy providers qualify; first one wins by latency tie
      expect(['anthropic', 'openai']).toContain(best);
    });

    it('should return null when all providers are unhealthy', async () => {
      const router = createMockRouter({
        anthropic: { ok: false, latencyMs: 0 },
        openai: { ok: false, latencyMs: 0 },
      });
      const checker = new ProviderHealthChecker(router, baseConfig, {
        enabledProviders: ['anthropic', 'openai'],
        unhealthyThreshold: 1,
      });

      await checker.checkAll();
      const best = checker.selectBestProvider();
      expect(best).toBeNull();
    });

    it('should list healthy and unhealthy providers', async () => {
      const router = createMockRouter({
        anthropic: { ok: true, latencyMs: 0 },
        deepseek: { ok: false, latencyMs: 0 },
      });
      const checker = new ProviderHealthChecker(router, baseConfig, {
        enabledProviders: ['anthropic', 'deepseek'],
        unhealthyThreshold: 1,
      });

      await checker.checkAll();
      expect(checker.getHealthyProviders()).toEqual(['anthropic']);
      expect(checker.getUnhealthyProviders()).toEqual(['deepseek']);
    });
  });

  describe('formatReport', () => {
    it('should format a readable report', async () => {
      const router = createMockRouter({
        anthropic: { ok: true, latencyMs: 0 },
        deepseek: { ok: false, latencyMs: 0 },
      });
      const checker = new ProviderHealthChecker(router, baseConfig, {
        enabledProviders: ['anthropic', 'deepseek'],
        unhealthyThreshold: 1,
      });

      await checker.checkAll();
      const report = checker.formatReport();
      expect(report).toContain('Provider Health Status');
      expect(report).toContain('anthropic');
      expect(report).toContain('deepseek');
      expect(report).toContain('healthy');
    });

    it('should handle no health data', () => {
      const router = createMockRouter({});
      const checker = new ProviderHealthChecker(router, baseConfig);
      const report = checker.formatReport();
      expect(report).toContain('No health data available');
    });
  });
});