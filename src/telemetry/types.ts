export type SpanKind = 'internal' | 'client' | 'server';
export type SpanStatus = 'ok' | 'error' | 'unset';

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface SpanData {
  name: string;
  context: SpanContext;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface TraceExport {
  traceId: string;
  rootSpan: SpanData;
  spans: SpanData[];
  durationMs: number;
  spanCount: number;
}

export interface TelemetryConfig {
  enabled: boolean;
  maxTraces?: number;
  sampleRate?: number;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
}
