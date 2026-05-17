import { describe, it, expect } from 'vitest';
import { Tracer } from '../../src/telemetry/tracer.js';
import { exportTracesToJson, exportToChromeTrace } from '../../src/telemetry/export.js';

describe('Telemetry Export', () => {
  it('exports traces as valid JSON', () => {
    const tracer = new Tracer({ enabled: true });
    const span = tracer.startSpan('test');
    span.end();

    const json = exportTracesToJson(tracer.getRecentTraces());
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].traceId).toBeDefined();
    expect(parsed[0].rootSpan.name).toBe('test');
  });

  it('exports to Chrome Trace format', () => {
    const tracer = new Tracer({ enabled: true });
    const span = tracer.startSpan('chat', { kind: 'client' });
    span.setAttribute('provider', 'openai');
    span.end();

    const events = exportToChromeTrace(tracer.getRecentTraces());
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].name).toBe('chat');
    expect(events[0].ph).toBe('X');
    expect(events[0].ts).toBeGreaterThan(0);
    expect(events[0].dur).toBeGreaterThanOrEqual(0);
    expect(events[0].args?.provider).toBe('openai');
  });

  it('handles empty traces', () => {
    expect(exportTracesToJson([])).toBe('[]');
    expect(exportToChromeTrace([])).toEqual([]);
  });
});
