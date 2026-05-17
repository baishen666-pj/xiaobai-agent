export { OTLPTraceExporter, type OTLPConfig } from './otlp.js';
export { PrometheusMetricsExporter, type PrometheusConfig } from './prometheus.js';

import type { OTLPConfig } from './otlp.js';
import type { PrometheusConfig } from './prometheus.js';
import type { OTLPTraceExporter } from './otlp.js';
import type { PrometheusMetricsExporter } from './prometheus.js';

export interface TelemetryExporters {
  trace?: OTLPTraceExporter;
  metrics?: PrometheusMetricsExporter;
}

export async function createExporters(config?: {
  otlp?: OTLPConfig;
  prometheus?: PrometheusConfig;
}): Promise<TelemetryExporters> {
  const result: TelemetryExporters = {};

  if (config?.otlp) {
    const { OTLPTraceExporter } = await import('./otlp.js');
    result.trace = new OTLPTraceExporter(config.otlp);
  }

  if (config?.prometheus) {
    const { PrometheusMetricsExporter } = await import('./prometheus.js');
    result.metrics = new PrometheusMetricsExporter(config.prometheus);
  }

  return result;
}
