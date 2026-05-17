import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { SpanContext, SpanData, SpanEvent, SpanKind, SpanStatus, TraceExport, TelemetryConfig, SpanOptions } from './types.js';

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export class Span {
  readonly context: SpanContext;
  readonly name: string;
  readonly kind: SpanKind;
  startTime: number;
  endTime?: number;
  status: SpanStatus = 'unset';
  attributes: Record<string, string | number | boolean> = {};
  events: SpanEvent[] = [];
  private tracer: Tracer;

  constructor(tracer: Tracer, name: string, context: SpanContext, kind: SpanKind, startTime: number) {
    this.tracer = tracer;
    this.name = name;
    this.context = context;
    this.kind = kind;
    this.startTime = startTime;
  }

  setAttribute(key: string, value: string | number | boolean): this {
    this.attributes[key] = value;
    return this;
  }

  addEvent(name: string, attributes?: Record<string, string | number | boolean>): this {
    this.events.push({ name, timestamp: Date.now(), attributes });
    return this;
  }

  setStatus(status: SpanStatus): this {
    this.status = status;
    return this;
  }

  end(): void {
    if (this.endTime) return;
    this.endTime = performance.now();
    this.tracer.onSpanEnd(this);
  }

  toData(): SpanData {
    return {
      name: this.name,
      context: this.context,
      kind: this.kind,
      startTime: this.startTime,
      endTime: this.endTime,
      status: this.status,
      attributes: { ...this.attributes },
      events: [...this.events],
    };
  }
}

export class Tracer {
  private enabled: boolean;
  private maxTraces: number;
  private sampleRate: number;
  private asyncLocal = new AsyncLocalStorage<Span>();
  private activeSpans = new Map<string, Span>();
  private traceSpans = new Map<string, Set<string>>();
  private completedTraces: TraceExport[] = [];

  constructor(config: TelemetryConfig) {
    this.enabled = config.enabled;
    this.maxTraces = config.maxTraces ?? 100;
    this.sampleRate = config.sampleRate ?? 1.0;
  }

  startSpan(name: string, options?: SpanOptions): Span {
    if (!this.enabled) return this.noopSpan(name);
    if (Math.random() > this.sampleRate) return this.noopSpan(name);

    const parent = this.asyncLocal.getStore();
    const traceId = parent?.context.traceId ?? randomHex(16);
    const spanId = randomHex(8);
    const context: SpanContext = {
      traceId,
      spanId,
      parentSpanId: parent?.context.spanId,
    };

    const span = new Span(this, name, context, options?.kind ?? 'internal', performance.now());

    if (options?.attributes) {
      for (const [k, v] of Object.entries(options.attributes)) {
        span.setAttribute(k, v);
      }
    }

    this.activeSpans.set(spanId, span);

    let spanSet = this.traceSpans.get(traceId);
    if (!spanSet) {
      spanSet = new Set();
      this.traceSpans.set(traceId, spanSet);
    }
    spanSet.add(spanId);

    return span;
  }

  runWithSpan<T>(span: Span, fn: () => T): T {
    if (!this.enabled) return fn();
    return this.asyncLocal.run(span, fn);
  }

  getActiveSpan(): Span | undefined {
    return this.asyncLocal.getStore();
  }

  getTrace(traceId: string): TraceExport | undefined {
    const spanIds = this.traceSpans.get(traceId);
    if (!spanIds) return undefined;

    const spans: SpanData[] = [];
    let rootSpan: SpanData | undefined;
    for (const id of spanIds) {
      const span = this.activeSpans.get(id);
      if (span) {
        const data = span.toData();
        spans.push(data);
        if (!data.context.parentSpanId) rootSpan = data;
      }
    }

    if (!rootSpan) return undefined;
    return {
      traceId,
      rootSpan,
      spans,
      durationMs: (rootSpan.endTime ?? performance.now()) - rootSpan.startTime,
      spanCount: spans.length,
    };
  }

  getRecentTraces(limit = 20): TraceExport[] {
    return this.completedTraces.slice(-limit).reverse();
  }

  clear(): void {
    this.activeSpans.clear();
    this.traceSpans.clear();
    this.completedTraces = [];
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  onSpanEnd(span: Span): void {
    const spanId = span.context.spanId;
    const traceId = span.context.traceId;

    // If no parent, this is a root span — complete the trace
    if (!span.context.parentSpanId) {
      const spanIds = this.traceSpans.get(traceId);
      const spans: SpanData[] = [];
      if (spanIds) {
        for (const id of spanIds) {
          const s = this.activeSpans.get(id);
          if (s) spans.push(s.toData());
        }
      }

      this.completedTraces.push({
        traceId,
        rootSpan: span.toData(),
        spans,
        durationMs: (span.endTime ?? performance.now()) - span.startTime,
        spanCount: spans.length,
      });

      // Ring buffer eviction
      if (this.completedTraces.length > this.maxTraces) {
        const evicted = this.completedTraces.shift()!;
        this.traceSpans.delete(evicted.traceId);
      }

      // Cleanup active spans for this trace
      if (spanIds) {
        for (const id of spanIds) this.activeSpans.delete(id);
      }
      this.traceSpans.delete(traceId);
    }
  }

  private noopSpan(name: string): Span {
    const ctx: SpanContext = { traceId: '', spanId: '' };
    const span = new Span(this, name, ctx, 'internal', 0);
    span.endTime = 0;
    return span;
  }
}
