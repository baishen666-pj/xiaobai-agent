import { describe, it, expect, vi } from 'vitest';
import { HealthChecker } from '../../src/server/health.js';

// ProviderRouter.getAvailableProviders is static, so we mock it
vi.mock('../../src/provider/router.js', () => ({
  ProviderRouter: {
    getAvailableProviders: vi.fn(() => ['anthropic', 'openai']),
  },
}));

function createMockDeps(overrides: Record<string, any> = {}) {
  return {
    provider: {
      ...overrides.provider,
    },
    memory: {
      getUsage: vi.fn(() => ({ memory: { used: 30, total: 100 }, user: { used: 12, total: 50 } })),
      ...overrides.memory,
    },
    sessions: {
      listSessions: vi.fn(async () => [{ id: 's1' }, { id: 's2' }]),
      ...overrides.sessions,
    },
    mcp: {
      discoverTools: vi.fn(async () => new Map([['server1', [{ name: 'tool1' }, { name: 'tool2' }]]])),
      ...overrides.mcp,
    },
    tools: overrides.tools ?? {},
    hooks: overrides.hooks ?? {},
    security: overrides.security ?? {},
    config: overrides.config ?? {},
  } as any;
}

describe('HealthChecker', () => {
  it('should return healthy when all subsystems are ok', async () => {
    const checker = new HealthChecker(createMockDeps());
    const result = await checker.check();

    expect(result.status).toBe('healthy');
    expect(result.checks.provider?.status).toBe('healthy');
    expect(result.checks.memory?.status).toBe('healthy');
    expect(result.checks.sessions?.status).toBe('healthy');
    expect(result.checks.mcp?.status).toBe('healthy');
    expect(result.version).toBe('0.6.0');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should return healthy when no deps', async () => {
    const checker = new HealthChecker();
    const result = await checker.check();

    expect(result.status).toBe('healthy');
    expect(Object.keys(result.checks)).toHaveLength(0);
  });

  it('should return degraded when provider has no providers', async () => {
    const { ProviderRouter } = await import('../../src/provider/router.js');
    (ProviderRouter.getAvailableProviders as any).mockReturnValueOnce([]);

    const checker = new HealthChecker(createMockDeps());
    const result = await checker.check();

    expect(result.checks.provider?.status).toBe('degraded');
  });

  it('should return unhealthy when subsystem throws', async () => {
    const { ProviderRouter } = await import('../../src/provider/router.js');
    (ProviderRouter.getAvailableProviders as any).mockImplementationOnce(() => { throw new Error('fail'); });

    const checker = new HealthChecker(createMockDeps());
    const result = await checker.check();

    expect(result.checks.provider?.status).toBe('unhealthy');
  });

  it('should compute worst status', async () => {
    const { ProviderRouter } = await import('../../src/provider/router.js');
    (ProviderRouter.getAvailableProviders as any).mockImplementationOnce(() => { throw new Error('fail'); });

    const checker = new HealthChecker(createMockDeps());
    const result = await checker.check();

    expect(result.status).toBe('unhealthy');
  });

  describe('readiness', () => {
    it('should be ready when provider and memory are healthy', async () => {
      const checker = new HealthChecker(createMockDeps());
      const { ready } = await checker.readiness();

      expect(ready).toBe(true);
    });

    it('should not be ready when provider is unhealthy', async () => {
      const { ProviderRouter } = await import('../../src/provider/router.js');
      (ProviderRouter.getAvailableProviders as any).mockImplementationOnce(() => { throw new Error('fail'); });

      const checker = new HealthChecker(createMockDeps());
      const { ready } = await checker.readiness();

      expect(ready).toBe(false);
    });

    it('should be ready when no deps', async () => {
      const checker = new HealthChecker();
      const { ready } = await checker.readiness();

      expect(ready).toBe(true);
    });
  });

  describe('liveness', () => {
    it('should always be alive', () => {
      const checker = new HealthChecker();
      const result = checker.liveness();

      expect(result.alive).toBe(true);
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});
