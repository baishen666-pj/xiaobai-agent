import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { RuntimeMetrics } from '../../core/metrics.js';

export interface PrometheusConfig {
  port?: number;
}

export class PrometheusMetricsExporter {
  private port: number;
  private server: ReturnType<typeof createServer> | null = null;
  private metrics: RuntimeMetrics | null = null;

  constructor(config?: PrometheusConfig) {
    this.port = config?.port ?? 9090;
  }

  setMetrics(metrics: RuntimeMetrics): void {
    this.metrics = metrics;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, () => resolve());
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => this.server!.close(() => resolve()));
  }

  private handleRequest(_req: IncomingMessage, res: ServerResponse): void {
    if (!this.metrics) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('# No metrics registered\n');
      return;
    }

    const snapshot = this.metrics.snapshot();
    const lines: string[] = [];

    for (const [name, value] of Object.entries(snapshot.counters ?? {})) {
      lines.push(`# TYPE xiaobai_${name} counter`);
      lines.push(`xiaobai_${name} ${value}`);
    }

    for (const [name, value] of Object.entries(snapshot.gauges ?? {})) {
      lines.push(`# TYPE xiaobai_${name} gauge`);
      lines.push(`xiaobai_${name} ${value}`);
    }

    for (const [name, histogram] of Object.entries(snapshot.histograms ?? {})) {
      lines.push(`# TYPE xiaobai_${name} summary`);
      if (typeof histogram === 'object' && histogram !== null) {
        for (const [quantile, val] of Object.entries(histogram)) {
          lines.push(`xiaobai_${name}{quantile="${quantile}"} ${val}`);
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(lines.join('\n') + '\n');
  }
}
