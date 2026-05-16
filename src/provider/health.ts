import { ProviderRouter } from './router.js';
import type { XiaobaiConfig } from '../config/manager.js';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthCheckResult {
  provider: string;
  status: HealthStatus;
  latencyMs: number;
  error?: string;
  checkedAt: number;
  consecutiveFailures: number;
}

export interface HealthCheckConfig {
  intervalMs: number;
  timeoutMs: number;
  unhealthyThreshold: number;
  degradedThresholdMs: number;
  enabledProviders?: string[];
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  intervalMs: 60_000,
  timeoutMs: 10_000,
  unhealthyThreshold: 3,
  degradedThresholdMs: 3000,
};

export class ProviderHealthChecker {
  private config: HealthCheckConfig;
  private results = new Map<string, HealthCheckResult>();
  private consecutiveFailures = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private router: ProviderRouter;
  private appConfig: XiaobaiConfig;

  constructor(router: ProviderRouter, appConfig: XiaobaiConfig, config?: Partial<HealthCheckConfig>) {
    this.router = router;
    this.appConfig = appConfig;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async checkProvider(providerName: string): Promise<HealthCheckResult> {
    const start = Date.now();
    const failures = this.consecutiveFailures.get(providerName) ?? 0;

    try {
      const provider = this.router.getProvider(providerName);
      if (!provider) {
        const result: HealthCheckResult = {
          provider: providerName,
          status: 'unknown',
          latencyMs: 0,
          error: 'Provider not found',
          checkedAt: Date.now(),
          consecutiveFailures: failures,
        };
        this.results.set(providerName, result);
        return result;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      await provider.chat(
        [{ role: 'user', content: 'ping' }],
        this.appConfig.model.default,
        { maxTokens: 1, abortSignal: controller.signal },
      );

      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      this.consecutiveFailures.set(providerName, 0);

      const status: HealthStatus = latencyMs > this.config.degradedThresholdMs ? 'degraded' : 'healthy';
      const result: HealthCheckResult = {
        provider: providerName,
        status,
        latencyMs,
        checkedAt: Date.now(),
        consecutiveFailures: 0,
      };
      this.results.set(providerName, result);
      return result;
    } catch (error) {
      const latencyMs = Date.now() - start;
      const newFailures = failures + 1;
      this.consecutiveFailures.set(providerName, newFailures);

      const status: HealthStatus = newFailures >= this.config.unhealthyThreshold ? 'unhealthy' : 'degraded';
      const result: HealthCheckResult = {
        provider: providerName,
        status,
        latencyMs,
        error: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now(),
        consecutiveFailures: newFailures,
      };
      this.results.set(providerName, result);
      return result;
    }
  }

  async checkAll(): Promise<HealthCheckResult[]> {
    const providers = this.config.enabledProviders ?? ProviderRouter.getAvailableProviders();
    const results = await Promise.all(
      providers.map((name) => this.checkProvider(name)),
    );
    return results;
  }

  startMonitoring(): void {
    this.stopMonitoring();
    this.checkAll().catch(() => {});
    this.timer = setInterval(() => {
      this.checkAll().catch(() => {});
    }, this.config.intervalMs);
  }

  stopMonitoring(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getHealth(providerName: string): HealthCheckResult | undefined {
    return this.results.get(providerName);
  }

  getAllHealth(): HealthCheckResult[] {
    return Array.from(this.results.values());
  }

  getHealthyProviders(): string[] {
    return Array.from(this.results.entries())
      .filter(([, r]) => r.status === 'healthy')
      .map(([name]) => name);
  }

  getUnhealthyProviders(): string[] {
    return Array.from(this.results.entries())
      .filter(([, r]) => r.status === 'unhealthy')
      .map(([name]) => name);
  }

  selectBestProvider(): string | null {
    const healthy = Array.from(this.results.entries())
      .filter(([, r]) => r.status === 'healthy' || r.status === 'degraded')
      .sort(([, a], [, b]) => a.latencyMs - b.latencyMs);

    return healthy.length > 0 ? healthy[0][0] : null;
  }

  formatReport(): string {
    const results = this.getAllHealth();
    if (results.length === 0) return 'No health data available.';

    const lines: string[] = ['Provider Health Status:'];
    const statusIcon = (s: HealthStatus) => {
      switch (s) {
        case 'healthy': return '✓';
        case 'degraded': return '⚠';
        case 'unhealthy': return '✗';
        case 'unknown': return '?';
      }
    };

    for (const r of results) {
      const icon = statusIcon(r.status);
      const latency = `${r.latencyMs}ms`;
      const err = r.error ? ` (${r.error})` : '';
      const failures = r.consecutiveFailures > 0 ? ` [${r.consecutiveFailures} failures]` : '';
      lines.push(`  ${icon} ${r.provider}: ${r.status} (${latency})${err}${failures}`);
    }

    return lines.join('\n');
  }
}
