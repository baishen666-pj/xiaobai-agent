import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderMetrics } from '../../src/provider/provider-metrics.js';
import type { ProviderMetricEntry } from '../../src/provider/provider-metrics.js';

describe('ProviderMetrics', () => {
  let metrics: ProviderMetrics;

  beforeEach(() => {
    metrics = new ProviderMetrics();
  });

  function makeEntry(overrides: Partial<ProviderMetricEntry> = {}): ProviderMetricEntry {
    return {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      latencyMs: 100,
      promptTokens: 50,
      completionTokens: 50,
      success: true,
      timestamp: Date.now(),
      ...overrides,
    };
  }

  it('records and retrieves entries', () => {
    metrics.record(makeEntry());
    metrics.record(makeEntry({ latencyMs: 200 }));
    expect(metrics.getEntryCount()).toBe(2);
  });

  it('getSummary returns null for unknown provider', () => {
    expect(metrics.getSummary('unknown')).toBeNull();
  });

  it('getSummary calculates correct stats', () => {
    metrics.record(makeEntry({ latencyMs: 100 }));
    metrics.record(makeEntry({ latencyMs: 200 }));
    metrics.record(makeEntry({ latencyMs: 300 }));

    const summary = metrics.getSummary('anthropic')!;
    expect(summary.requestCount).toBe(3);
    expect(summary.avgLatencyMs).toBe(200);
    expect(summary.errorRate).toBe(0);
    expect(summary.totalTokensUsed).toBe(300);
  });

  it('getSummary calculates error rate', () => {
    metrics.record(makeEntry({ success: true }));
    metrics.record(makeEntry({ success: false, errorType: 'timeout' }));
    metrics.record(makeEntry({ success: true }));
    metrics.record(makeEntry({ success: false, errorType: 'rate_limit' }));

    const summary = metrics.getSummary('anthropic')!;
    expect(summary.errorRate).toBe(0.5);
  });

  it('getSummary respects time window', () => {
    const now = Date.now();
    metrics.record(makeEntry({ timestamp: now - 5000 }));
    metrics.record(makeEntry({ timestamp: now - 3000 }));
    metrics.record(makeEntry({ timestamp: now - 1000 }));

    const summary = metrics.getSummary('anthropic', 2000)!;
    expect(summary.requestCount).toBe(1);
  });

  it('p50 and p95 latency calculations', () => {
    for (let i = 1; i <= 20; i++) {
      metrics.record(makeEntry({ latencyMs: i * 10 }));
    }

    const summary = metrics.getSummary('anthropic')!;
    expect(summary.p50LatencyMs).toBe(110);
    expect(summary.p95LatencyMs).toBe(200);
  });

  it('avgTokensPerSec from entries with tps', () => {
    metrics.record(makeEntry({ tokensPerSecond: 50 }));
    metrics.record(makeEntry({ tokensPerSecond: 100 }));
    metrics.record(makeEntry({ tokensPerSecond: undefined }));

    const summary = metrics.getSummary('anthropic')!;
    expect(summary.avgTokensPerSec).toBe(75);
  });

  it('getAllSummaries returns per-provider stats', () => {
    metrics.record(makeEntry({ provider: 'anthropic' }));
    metrics.record(makeEntry({ provider: 'openai' }));
    metrics.record(makeEntry({ provider: 'anthropic' }));

    const summaries = metrics.getAllSummaries();
    expect(summaries.length).toBe(2);
    const anthro = summaries.find((s) => s.provider === 'anthropic')!;
    expect(anthro.requestCount).toBe(2);
  });

  it('getTopProviders sorts by latency', () => {
    metrics.record(makeEntry({ provider: 'slow', latencyMs: 500 }));
    metrics.record(makeEntry({ provider: 'fast', latencyMs: 50 }));
    metrics.record(makeEntry({ provider: 'medium', latencyMs: 200 }));

    const top = metrics.getTopProviders(2);
    expect(top[0].provider).toBe('fast');
    expect(top[1].provider).toBe('medium');
  });

  it('clear removes all entries', () => {
    metrics.record(makeEntry());
    metrics.record(makeEntry());
    metrics.clear();
    expect(metrics.getEntryCount()).toBe(0);
    expect(metrics.getSummary('anthropic')).toBeNull();
  });

  it('respects maxEntries limit', () => {
    const small = new ProviderMetrics(5);
    for (let i = 0; i < 10; i++) {
      small.record(makeEntry({ latencyMs: i }));
    }
    expect(small.getEntryCount()).toBe(5);
    const summary = small.getSummary('anthropic')!;
    expect(summary.requestCount).toBe(5);
    expect(summary.avgLatencyMs).toBe(7);
  });
});
