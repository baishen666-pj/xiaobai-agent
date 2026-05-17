import type { AgentDeps } from '../core/agent.js';
import { ProviderRouter } from '../provider/router.js';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface SubsystemCheck {
  status: HealthStatus;
  latencyMs: number;
  detail?: string;
}

export interface HealthResult {
  status: HealthStatus;
  timestamp: number;
  uptime: number;
  version: string;
  checks: {
    provider?: SubsystemCheck;
    memory?: SubsystemCheck;
    sessions?: SubsystemCheck;
    mcp?: SubsystemCheck;
  };
  details: Record<string, unknown>;
}

const AGGREGATE: Record<HealthStatus, number> = { healthy: 0, degraded: 1, unhealthy: 2 };

function worstStatus(...statuses: HealthStatus[]): HealthStatus {
  let worst: HealthStatus = 'healthy';
  for (const s of statuses) {
    if (AGGREGATE[s] > AGGREGATE[worst]) worst = s;
  }
  return worst;
}

export class HealthChecker {
  private deps?: AgentDeps;
  private startTime = Date.now();

  constructor(deps?: AgentDeps) {
    this.deps = deps;
  }

  async check(): Promise<HealthResult> {
    const checks: HealthResult['checks'] = {};

    if (this.deps) {
      const [provider, memory, sessions, mcp] = await Promise.allSettled([
        this.checkProvider(),
        this.checkMemory(),
        this.checkSessions(),
        this.checkMcp(),
      ]);

      if (provider.status === 'fulfilled') checks.provider = provider.value;
      if (memory.status === 'fulfilled') checks.memory = memory.value;
      if (sessions.status === 'fulfilled') checks.sessions = sessions.value;
      if (mcp.status === 'fulfilled') checks.mcp = mcp.value;
    }

    const values = Object.values(checks);
    const status = values.length > 0
      ? worstStatus(...values.map((c) => c.status))
      : 'healthy';

    return {
      status,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      version: '0.6.0',
      checks,
      details: {},
    };
  }

  async readiness(): Promise<{ ready: boolean; checks: HealthResult['checks'] }> {
    const checks: HealthResult['checks'] = {};

    if (this.deps) {
      const [provider, memory] = await Promise.allSettled([
        this.checkProvider(),
        this.checkMemory(),
      ]);

      if (provider.status === 'fulfilled') checks.provider = provider.value;
      if (memory.status === 'fulfilled') checks.memory = memory.value;
    }

    const values = Object.values(checks);
    const ready = values.length > 0
      ? values.every((c) => c.status !== 'unhealthy')
      : true;

    return { ready, checks };
  }

  liveness(): { alive: boolean; uptime: number } {
    return { alive: true, uptime: Date.now() - this.startTime };
  }

  private async checkProvider(): Promise<SubsystemCheck> {
    if (!this.deps?.provider) {
      return { status: 'degraded', latencyMs: 0, detail: 'No provider configured' };
    }
    const start = Date.now();
    try {
      const providers = ProviderRouter.getAvailableProviders();
      return {
        status: providers && providers.length > 0 ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        detail: `${providers?.length ?? 0} providers available`,
      };
    } catch {
      return { status: 'unhealthy', latencyMs: Date.now() - start, detail: 'Provider check failed' };
    }
  }

  private async checkMemory(): Promise<SubsystemCheck> {
    if (!this.deps?.memory) {
      return { status: 'degraded', latencyMs: 0, detail: 'No memory system' };
    }
    const start = Date.now();
    try {
      const usage = this.deps.memory.getUsage();
      const totalEntries = usage.memory.used + usage.user.used;
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        detail: `${totalEntries} entries`,
      };
    } catch {
      return { status: 'unhealthy', latencyMs: Date.now() - start, detail: 'Memory check failed' };
    }
  }

  private async checkSessions(): Promise<SubsystemCheck> {
    if (!this.deps?.sessions) {
      return { status: 'degraded', latencyMs: 0, detail: 'No session manager' };
    }
    const start = Date.now();
    try {
      const sessions = await this.deps.sessions.listSessions();
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        detail: `${sessions.length} sessions`,
      };
    } catch {
      return { status: 'unhealthy', latencyMs: Date.now() - start, detail: 'Session check failed' };
    }
  }

  private async checkMcp(): Promise<SubsystemCheck> {
    if (!this.deps?.mcp) {
      return { status: 'degraded', latencyMs: 0, detail: 'No MCP configured' };
    }
    const start = Date.now();
    try {
      const toolMap = await this.deps.mcp.discoverTools();
      const toolCount = [...toolMap.values()].reduce((sum, arr) => sum + arr.length, 0);
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        detail: `${toolCount} MCP tools`,
      };
    } catch {
      return { status: 'unhealthy', latencyMs: Date.now() - start, detail: 'MCP check failed' };
    }
  }
}
