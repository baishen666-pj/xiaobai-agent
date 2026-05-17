import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DashboardServer } from '../../src/server/index.js';
import { Tracer } from '../../src/telemetry/tracer.js';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = require('node:http').createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get port')));
      }
    });
  });
}

async function fetchSSE(port: number, path: string, headers: Record<string, string> = {}): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
}> {
  const url = `http://localhost:${port}${path}`;
  const res = await fetch(url, { headers });

  const body = await res.text();
  const headerMap: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headerMap[key] = value;
  });

  return { status: res.status, headers: headerMap, body };
}

describe('SSE Endpoint', () => {
  let server: DashboardServer;
  let port: number;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it('returns correct content-type headers for SSE', async () => {
    port = await getFreePort();
    server = new DashboardServer({ port, sseEnabled: true });
    await server.start();

    const controller = new AbortController();
    const url = `http://localhost:${port}/events`;
    const res = await fetch(url, { signal: controller.signal });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('connection')).toBe('keep-alive');

    controller.abort();
  });

  it('sends initial connected comment', async () => {
    port = await getFreePort();
    server = new DashboardServer({ port, sseEnabled: true });
    await server.start();

    const url = `http://localhost:${port}/events`;
    const res = await fetch(url);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toBe(': connected\n\n');

    await reader.cancel();
  });

  it('broadcasts events in SSE format with id field', async () => {
    port = await getFreePort();
    server = new DashboardServer({ port, sseEnabled: true });
    await server.start();

    const url = `http://localhost:${port}/events`;
    const res = await fetch(url);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read the initial connected comment
    await reader.read();

    // Broadcast an event
    server.getBridge().broadcast({ type: 'all_completed', results: [] });

    // Read the SSE event
    const { value } = await reader.read();
    const text = decoder.decode(value);

    expect(text).toContain('id: 1\n');
    expect(text).toContain('data: ');
    expect(text).toContain('"type":"all_completed"');
    expect(text).toMatch(/\n\n$/);

    await reader.cancel();
  });

  it('increments event id across broadcasts', async () => {
    port = await getFreePort();
    server = new DashboardServer({ port, sseEnabled: true });
    await server.start();

    const url = `http://localhost:${port}/events`;
    const res = await fetch(url);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    await reader.read(); // connected

    server.getBridge().broadcast({ type: 'all_completed', results: [] });
    const { value: v1 } = await reader.read();
    const text1 = decoder.decode(v1);
    expect(text1).toContain('id: 1\n');

    server.getBridge().broadcast({ type: 'task_started', task: { id: 't1' }, agentId: 'a1' });
    const { value: v2 } = await reader.read();
    const text2 = decoder.decode(v2);
    expect(text2).toContain('id: 2\n');

    await reader.cancel();
  });

  it('returns non-SSE response when sseEnabled is false', async () => {
    port = await getFreePort();
    server = new DashboardServer({ port, sseEnabled: false });
    await server.start();

    const result = await fetchSSE(port, '/events');
    // When SSE is disabled, /events falls through to static file serving
    // (either 404 or SPA fallback with index.html), not SSE
    expect(result.headers['content-type']).not.toBe('text/event-stream');
  });

  it('cleans up SSE client on disconnect', async () => {
    port = await getFreePort();
    server = new DashboardServer({ port, sseEnabled: true });
    await server.start();

    const initialCount = server.getBridge().getClientCount();

    const url = `http://localhost:${port}/events`;
    const res = await fetch(url);
    const reader = res.body!.getReader();
    await reader.read(); // connected

    // SSE client should be registered now
    expect(server.getBridge().getClientCount()).toBe(initialCount + 1);

    // Disconnect
    await reader.cancel();

    // Give time for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(server.getBridge().getClientCount()).toBe(initialCount);
  });

  it('replays missed events based on Last-Event-ID', async () => {
    port = await getFreePort();
    server = new DashboardServer({ port, sseEnabled: true });
    await server.start();

    // Broadcast some events first
    server.getBridge().broadcast({ type: 'all_completed', results: [] });
    server.getBridge().broadcast({ type: 'all_completed', results: [] });
    server.getBridge().broadcast({ type: 'all_completed', results: [] });

    // Connect with Last-Event-ID: 1, should replay events 2 and 3
    const url = `http://localhost:${port}/events`;
    const res = await fetch(url, { headers: { 'Last-Event-ID': '1' } });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read with a timeout to collect replayed + connected data
    const chunks: string[] = [];
    const readWithTimeout = async (): Promise<string | null> => {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 200));
      const result = await Promise.race([reader.read(), timeout]);
      if (result === null) return null;
      return decoder.decode(result.value);
    };

    // First read should contain the replayed events + connected comment
    const first = await readWithTimeout();
    if (first) chunks.push(first);

    const second = await readWithTimeout();
    if (second) chunks.push(second);

    const allText = chunks.join('');

    // Should have replayed events with id 2 and 3
    expect(allText).toContain('id: 2\n');
    expect(allText).toContain('id: 3\n');

    await reader.cancel();
  });

  it('includes SSE clients in getClientCount', async () => {
    port = await getFreePort();
    server = new DashboardServer({ port, sseEnabled: true });
    await server.start();

    const baseCount = server.getBridge().getClientCount();

    // Connect two SSE clients
    const url = `http://localhost:${port}/events`;
    const res1 = await fetch(url);
    const reader1 = res1.body!.getReader();
    await reader1.read();

    const res2 = await fetch(url);
    const reader2 = res2.body!.getReader();
    await reader2.read();

    expect(server.getBridge().getClientCount()).toBe(baseCount + 2);

    await reader1.cancel();
    await reader2.cancel();
  });
});

describe('/api/traces endpoint', () => {
  let server: DashboardServer;
  let port: number;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it('returns 404 when tracer is not configured', async () => {
    port = await getFreePort();
    server = new DashboardServer({ port });
    await server.start();

    const res = await fetch(`http://localhost:${port}/api/traces`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Tracer not configured');
  });

  it('returns traces when tracer is configured', async () => {
    port = await getFreePort();
    const tracer = new Tracer({ enabled: true });
    vi.spyOn(tracer, 'getRecentTraces').mockReturnValue(
      Array.from({ length: 3 }, (_, i) => ({
        traceId: `trace-${i}`,
        rootSpan: { name: `Trace ${i}` } as any,
        spans: [],
        durationMs: 100,
        spanCount: 1,
      })),
    );
    server = new DashboardServer({ port, tracer });
    await server.start();

    const res = await fetch(`http://localhost:${port}/api/traces?limit=3`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(3);
    expect(body[0].traceId).toBe('trace-0');
  });

  it('respects limit parameter', async () => {
    port = await getFreePort();
    const tracer = new Tracer({ enabled: true });
    vi.spyOn(tracer, 'getRecentTraces').mockReturnValue(
      Array.from({ length: 10 }, (_, i) => ({
        traceId: `t-${i}`,
        rootSpan: {} as any,
        spans: [],
        durationMs: 50,
        spanCount: 1,
      })),
    );
    server = new DashboardServer({ port, tracer });
    await server.start();

    const res = await fetch(`http://localhost:${port}/api/traces?limit=10`);
    const body = await res.json();
    expect(body).toHaveLength(10);
  });

  it('uses default limit of 20 when not specified', async () => {
    port = await getFreePort();
    const tracer = new Tracer({ enabled: true });
    const spy = vi.spyOn(tracer, 'getRecentTraces').mockReturnValue([]);
    server = new DashboardServer({ port, tracer });
    await server.start();

    await fetch(`http://localhost:${port}/api/traces`);
    expect(spy).toHaveBeenCalledWith(20);
  });
});
