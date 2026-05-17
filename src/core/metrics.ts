export interface MetricSample {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface MetricSummary {
  name: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  unit: string;
  tags?: Record<string, string>;
}

export interface MetricsSnapshot {
  timestamp: number;
  uptime: number;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, MetricSummary>;
  custom: Record<string, unknown>;
}

export class RuntimeMetrics {
  private startTime: number;
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private customMetrics = new Map<string, unknown>();
  private samples: MetricSample[] = [];
  private maxSamplesPerMetric: number;

  constructor(maxSamplesPerMetric: number = 1000) {
    this.startTime = Date.now();
    this.maxSamplesPerMetric = maxSamplesPerMetric;
  }

  // ── Counters ──

  incrementCounter(name: string, value: number = 1, tags?: Record<string, string>): void {
    const key = this.metricKey(name, tags);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
    this.recordSample(name, value, 'count', tags);
  }

  getCounter(name: string, tags?: Record<string, string>): number {
    return this.counters.get(this.metricKey(name, tags)) ?? 0;
  }

  // ── Gauges ──

  setGauge(name: string, value: number, tags?: Record<string, string>): void {
    this.gauges.set(this.metricKey(name, tags), value);
    this.recordSample(name, value, 'gauge', tags);
  }

  getGauge(name: string, tags?: Record<string, string>): number {
    return this.gauges.get(this.metricKey(name, tags)) ?? 0;
  }

  // ── Histograms ──

  recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.metricKey(name, tags);
    let arr = this.histograms.get(key);
    if (!arr) {
      arr = [];
      this.histograms.set(key, arr);
    }
    arr.push(value);
    if (arr.length > this.maxSamplesPerMetric) {
      this.histograms.set(key, arr.slice(-this.maxSamplesPerMetric));
    }
    this.recordSample(name, value, 'ms', tags);
  }

  getHistogramSummary(name: string, tags?: Record<string, string>): MetricSummary | null {
    const key = this.metricKey(name, tags);
    const values = this.histograms.get(key);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      name,
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))],
      unit: 'ms',
      tags,
    };
  }

  // ── Custom metrics ──

  setCustom(name: string, value: unknown): void {
    this.customMetrics.set(name, value);
  }

  getCustom(name: string): unknown {
    return this.customMetrics.get(name);
  }

  // ── Snapshots ──

  snapshot(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;

    const gauges: Record<string, number> = {};
    for (const [k, v] of this.gauges) gauges[k] = v;

    const histograms: Record<string, MetricSummary> = {};
    for (const [k] of this.histograms) {
      const summary = this.getHistogramSummaryByKey(k);
      if (summary) histograms[k] = summary;
    }

    const custom: Record<string, unknown> = {};
    for (const [k, v] of this.customMetrics) custom[k] = v;

    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      counters,
      gauges,
      histograms,
      custom,
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.customMetrics.clear();
    this.samples = [];
    this.startTime = Date.now();
  }

  // ── Report ──

  formatReport(): string {
    const snap = this.snapshot();
    const lines: string[] = [];
    const uptimeSec = (snap.uptime / 1000).toFixed(1);

    lines.push(`Runtime Metrics Report (uptime: ${uptimeSec}s)`);
    lines.push('');

    if (Object.keys(snap.counters).length > 0) {
      lines.push('Counters:');
      for (const [name, value] of Object.entries(snap.counters)) {
        lines.push(`  ${name}: ${value}`);
      }
      lines.push('');
    }

    if (Object.keys(snap.gauges).length > 0) {
      lines.push('Gauges:');
      for (const [name, value] of Object.entries(snap.gauges)) {
        lines.push(`  ${name}: ${value}`);
      }
      lines.push('');
    }

    if (Object.keys(snap.histograms).length > 0) {
      lines.push('Histograms:');
      for (const [name, summary] of Object.entries(snap.histograms)) {
        const s = summary as MetricSummary;
        lines.push(`  ${name}: count=${s.count} mean=${s.mean.toFixed(2)}ms p50=${s.p50.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms p99=${s.p99.toFixed(2)}ms`);
      }
      lines.push('');
    }

    if (Object.keys(snap.custom).length > 0) {
      lines.push('Custom:');
      for (const [name, value] of Object.entries(snap.custom)) {
        lines.push(`  ${name}: ${JSON.stringify(value)}`);
      }
    }

    return lines.join('\n');
  }

  // ── Helpers ──

  private metricKey(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) return name;
    const tagStr = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
    return `${name}{${tagStr}}`;
  }

  private recordSample(name: string, value: number, unit: string, tags?: Record<string, string>): void {
    this.samples.push({
      name,
      value,
      unit,
      timestamp: Date.now(),
      tags,
    });

    if (this.samples.length > this.maxSamplesPerMetric * 10) {
      this.samples = this.samples.slice(-this.maxSamplesPerMetric * 5);
    }
  }

  private getHistogramSummaryByKey(key: string): MetricSummary | null {
    const values = this.histograms.get(key);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    // Extract name from key (strip tags)
    const name = key.includes('{') ? key.split('{')[0] : key;

    return {
      name,
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))],
      unit: 'ms',
    };
  }
}