import { describe, it, expect, beforeEach } from 'vitest';
import { Tracer } from '../../src/telemetry/tracer.js';

describe('Tracer', () => {
  let tracer: Tracer;

  beforeEach(() => {
    tracer = new Tracer({ enabled: true, maxTraces: 10 });
  });

  it('starts with no completed traces', () => {
    expect(tracer.getRecentTraces()).toEqual([]);
  });

  it('creates a root span with valid IDs', () => {
    const span = tracer.startSpan('test.root');
    expect(span.context.traceId).toHaveLength(32);
    expect(span.context.spanId).toHaveLength(16);
    expect(span.context.parentSpanId).toBeUndefined();
  });

  it('creates child spans linked to parent via AsyncLocalStorage', () => {
    const root = tracer.startSpan('root');
    tracer.runWithSpan(root, () => {
      const child = tracer.startSpan('child');
      expect(child.context.parentSpanId).toBe(root.context.spanId);
      expect(child.context.traceId).toBe(root.context.traceId);
    });
  });

  it('records span end time', () => {
    const span = tracer.startSpan('test');
    span.end();
    expect(span.endTime).toBeDefined();
    expect(span.endTime!).toBeGreaterThan(span.startTime);
  });

  it('moves trace to completed buffer on root span end', () => {
    const root = tracer.startSpan('root');
    root.end();

    const traces = tracer.getRecentTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].rootSpan.name).toBe('root');
    expect(traces[0].spanCount).toBe(1);
  });

  it('evicts oldest traces when maxTraces exceeded', () => {
    for (let i = 0; i < 15; i++) {
      const span = tracer.startSpan(`trace_${i}`);
      span.end();
    }
    expect(tracer.getRecentTraces().length).toBeLessThanOrEqual(10);
  });

  it('records attributes on spans', () => {
    const span = tracer.startSpan('test', {
      attributes: { key1: 'val1', key2: 42 },
    });
    expect(span.attributes.key1).toBe('val1');
    expect(span.attributes.key2).toBe(42);
  });

  it('records events on spans', () => {
    const span = tracer.startSpan('test');
    span.addEvent('something_happened', { detail: 'info' });
    expect(span.events).toHaveLength(1);
    expect(span.events[0].name).toBe('something_happened');
  });

  it('sets span status', () => {
    const span = tracer.startSpan('test');
    span.setStatus('error');
    expect(span.status).toBe('error');
  });

  it('respects sampleRate=0', () => {
    const strict = new Tracer({ enabled: true, sampleRate: 0 });
    const span = strict.startSpan('test');
    expect(span.context.traceId).toBe('');
  });

  it('noopSpan end is idempotent', () => {
    const strict = new Tracer({ enabled: false });
    const span = strict.startSpan('test');
    span.end();
    expect(tracer.getRecentTraces()).toHaveLength(0);
  });

  it('getActiveSpan returns undefined outside runWithSpan', () => {
    expect(tracer.getActiveSpan()).toBeUndefined();
  });

  it('getActiveSpan returns current span inside runWithSpan', () => {
    const span = tracer.startSpan('active');
    tracer.runWithSpan(span, () => {
      expect(tracer.getActiveSpan()).toBe(span);
    });
  });

  it('clear resets all state', () => {
    const span = tracer.startSpan('test');
    span.end();
    tracer.clear();
    expect(tracer.getRecentTraces()).toEqual([]);
  });

  it('includes child spans in completed trace', () => {
    const root = tracer.startSpan('root');
    tracer.runWithSpan(root, () => {
      const child = tracer.startSpan('child');
      child.end();
    });
    root.end();

    const traces = tracer.getRecentTraces();
    expect(traces[0].spanCount).toBe(2);
  });
});
