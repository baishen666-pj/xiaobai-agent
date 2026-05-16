export interface ProviderMetricEntry {
  provider: string;
  model: string;
  latencyMs: number;
  tokensPerSecond?: number;
  promptTokens: number;
  completionTokens: number;
  success: boolean;
  errorType?: string;
  timestamp: number;
}

export interface ProviderMetricsSummary {
  provider: string;
  requestCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgTokensPerSec: number;
  totalTokensUsed: number;
}

export class ProviderMetrics {
  private entries: ProviderMetricEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  record(entry: ProviderMetricEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  private filterEntries(provider: string, windowMs?: number): ProviderMetricEntry[] {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    return this.entries.filter(
      (e) => e.provider === provider && e.timestamp >= cutoff,
    );
  }

  getSummary(provider: string, windowMs?: number): ProviderMetricsSummary | null {
    const filtered = this.filterEntries(provider, windowMs);
    if (filtered.length === 0) return null;

    const latencies = filtered.map((e) => e.latencyMs).sort((a, b) => a - b);
    const errors = filtered.filter((e) => !e.success).length;
    const withTps = filtered.filter((e) => e.tokensPerSecond !== undefined);
    const avgTps = withTps.length > 0
      ? withTps.reduce((s, e) => s + (e.tokensPerSecond ?? 0), 0) / withTps.length
      : 0;

    return {
      provider,
      requestCount: filtered.length,
      errorRate: errors / filtered.length,
      avgLatencyMs: latencies.reduce((s, l) => s + l, 0) / latencies.length,
      p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
      avgTokensPerSec: avgTps,
      totalTokensUsed: filtered.reduce((s, e) => s + e.promptTokens + e.completionTokens, 0),
    };
  }

  getAllSummaries(windowMs?: number): ProviderMetricsSummary[] {
    const providers = new Set(this.entries.map((e) => e.provider));
    const summaries: ProviderMetricsSummary[] = [];
    for (const p of providers) {
      const summary = this.getSummary(p, windowMs);
      if (summary) summaries.push(summary);
    }
    return summaries;
  }

  getTopProviders(n: number, windowMs?: number): ProviderMetricsSummary[] {
    return this.getAllSummaries(windowMs)
      .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)
      .slice(0, n);
  }

  clear(): void {
    this.entries = [];
  }

  getEntryCount(): number {
    return this.entries.length;
  }
}
