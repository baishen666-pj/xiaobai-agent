import type { TraceExport } from '../types.js';

export interface OTLPConfig {
  endpoint: string;
  headers?: Record<string, string>;
  batchSize?: number;
  intervalMs?: number;
}

export class OTLPTraceExporter {
  private endpoint: string;
  private headers: Record<string, string>;
  private batchSize: number;
  private intervalMs: number;
  private batch: TraceExport[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: OTLPConfig) {
    this.endpoint = config.endpoint;
    this.headers = config.headers ?? {};
    this.batchSize = config.batchSize ?? 100;
    this.intervalMs = config.intervalMs ?? 5000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  async export(trace: TraceExport): Promise<void> {
    this.batch.push(trace);
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const traces = [...this.batch];
    this.batch = [];

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({ traces }),
      });
    } catch {
      // Best-effort export
    }
  }
}
