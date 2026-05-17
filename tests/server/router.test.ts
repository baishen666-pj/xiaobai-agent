import { describe, it, expect } from 'vitest';
import { Router } from '../../src/server/router.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function createMockReq(method: string, url: string, body?: unknown): IncomingMessage {
  return {
    method,
    url,
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
    on: (event: string, handler: any) => {
      if (event === 'data' && body) handler(Buffer.from(JSON.stringify(body)));
      if (event === 'end') handler();
    },
    destroy: () => {},
  } as any;
}

function createMockRes(): ServerResponse & { body: string; statusCode: number; headers: Record<string, string> } {
  let body = '';
  const headers: Record<string, string> = {};
  return {
    body,
    statusCode: 200,
    headers,
    writeHead(status: number, hdrs?: Record<string, string>) {
      (this as any).statusCode = status;
      if (hdrs) Object.assign((this as any).headers, hdrs);
    },
    end(data?: string | Buffer) {
      (this as any).body = typeof data === 'string' ? data : '';
    },
    setHeader(key: string, value: string) {
      (this as any).headers[key] = value;
    },
    writableEnded: false,
  } as any;
}

describe('Router', () => {
  it('should match exact GET route', async () => {
    const router = new Router();
    let called = false;
    router.get('/api/test', async (ctx) => { called = true; ctx.res.writeHead(200); ctx.res.end('ok'); });

    const req = createMockReq('GET', '/api/test');
    const res = createMockRes();
    const handled = await router.handle(req, res);

    expect(handled).toBe(true);
    expect(called).toBe(true);
  });

  it('should match route with params', async () => {
    const router = new Router();
    let capturedId = '';
    router.get('/api/items/:id', async (ctx) => { capturedId = ctx.params.id; ctx.res.writeHead(200); ctx.res.end(); });

    const req = createMockReq('GET', '/api/items/abc123');
    const res = createMockRes();
    await router.handle(req, res);

    expect(capturedId).toBe('abc123');
  });

  it('should parse query string', async () => {
    const router = new Router();
    let capturedQuery: Record<string, string> = {};
    router.get('/api/search', async (ctx) => { capturedQuery = ctx.query; ctx.res.writeHead(200); ctx.res.end(); });

    const req = createMockReq('GET', '/api/search?q=hello&limit=10');
    const res = createMockRes();
    await router.handle(req, res);

    expect(capturedQuery.q).toBe('hello');
    expect(capturedQuery.limit).toBe('10');
  });

  it('should parse JSON body for POST', async () => {
    const router = new Router();
    let capturedBody: unknown;
    router.post('/api/data', async (ctx) => { capturedBody = ctx.body; ctx.res.writeHead(200); ctx.res.end(); });

    const req = createMockReq('POST', '/api/data', { name: 'test' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(capturedBody).toEqual({ name: 'test' });
  });

  it('should return false for unmatched route', async () => {
    const router = new Router();
    router.get('/api/test', async (ctx) => { ctx.res.writeHead(200); ctx.res.end(); });

    const req = createMockReq('GET', '/api/notfound');
    const res = createMockRes();
    const handled = await router.handle(req, res);

    expect(handled).toBe(false);
  });

  it('should run middleware chain', async () => {
    const router = new Router();
    const order: number[] = [];

    router.use(async (_ctx, next) => { order.push(1); await next(); });
    router.use(async (_ctx, next) => { order.push(2); await next(); });
    router.get('/test', async (ctx) => { order.push(3); ctx.res.writeHead(200); ctx.res.end(); });

    const req = createMockReq('GET', '/test');
    const res = createMockRes();
    await router.handle(req, res);

    expect(order).toEqual([1, 2, 3]);
  });

  it('should set requestId on context', async () => {
    const router = new Router();
    let requestId = '';
    router.get('/test', async (ctx) => { requestId = ctx.requestId; ctx.res.writeHead(200); ctx.res.end(); });

    const req = createMockReq('GET', '/test');
    const res = createMockRes();
    await router.handle(req, res);

    expect(requestId).toBeTruthy();
  });
});
