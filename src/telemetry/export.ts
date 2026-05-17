import type { TraceExport, SpanData } from './types.js';

export interface ChromeTraceEvent {
  name: string;
  cat: string;
  ph: 'X';
  ts: number;
  dur: number;
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
}

export function exportTracesToJson(traces: TraceExport[]): string {
  return JSON.stringify(traces, null, 2);
}

export function exportToChromeTrace(traces: TraceExport[]): ChromeTraceEvent[] {
  const events: ChromeTraceEvent[] = [];

  for (const trace of traces) {
    for (const span of trace.spans) {
      if (!span.endTime) continue;
      events.push(spanToChromeEvent(span));
    }
  }

  return events;
}

function spanToChromeEvent(span: SpanData): ChromeTraceEvent {
  const durationUs = span.endTime
    ? Math.round((span.endTime - span.startTime) * 1000)
    : 0;

  return {
    name: span.name,
    cat: span.kind,
    ph: 'X',
    ts: Math.round(span.startTime * 1000),
    dur: durationUs,
    pid: 1,
    tid: hashToTid(span.context.traceId),
    args: {
      ...span.attributes,
      spanId: span.context.spanId,
      parentSpanId: span.context.parentSpanId,
      status: span.status,
      events: span.events.length > 0 ? span.events : undefined,
    },
  };
}

function hashToTid(traceId: string): number {
  let hash = 0;
  for (let i = 0; i < traceId.length; i++) {
    hash = ((hash << 5) - hash + traceId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 1000 + 1;
}
