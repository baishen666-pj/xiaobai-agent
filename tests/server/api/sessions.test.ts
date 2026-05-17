import { describe, it, expect, vi } from 'vitest';
import { registerSessionRoutes } from '../../../src/server/api/sessions.js';
import { Router } from '../../../src/server/router.js';
import type { IncomingMessage } from 'node:http';

function createMockReq(method: string, url: string): IncomingMessage {
  return {
    method, url, headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
    on: (event: string, handler: any) => { if (event === 'end') handler(); },
  } as any;
}

function createMockRes() {
  let body = '';
  return {
    statusCode: 200, headers: {},
    writeHead(status: number, hdrs?: any) { (this as any).statusCode = status; },
    end(data?: string) { (this as any).body = typeof data === 'string' ? data : ''; },
    setHeader() {},
  } as any;
}

describe('Session API', () => {
  it('GET /api/sessions should list sessions', async () => {
    const router = new Router();
    const deps = {
      sessions: { listSessions: vi.fn(async () => [{ id: 's1' }]) },
    } as any;
    registerSessionRoutes(router, deps);

    const req = createMockReq('GET', '/api/sessions');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.sessions).toHaveLength(1);
  });

  it('GET /api/sessions/:id should return session', async () => {
    const router = new Router();
    const deps = {
      sessions: { loadSessionState: vi.fn(async () => ({ id: 's1', messages: [] })) },
    } as any;
    registerSessionRoutes(router, deps);

    const req = createMockReq('GET', '/api/sessions/s1');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('DELETE /api/sessions/:id should delete session', async () => {
    const router = new Router();
    const deps = {
      sessions: { deleteSession: vi.fn(async () => {}) },
    } as any;
    registerSessionRoutes(router, deps);

    const req = createMockReq('DELETE', '/api/sessions/s1');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.deleted).toBe(true);
  });

  it('GET /api/sessions returns 503 when no session manager', async () => {
    const router = new Router();
    const deps = {} as any;
    registerSessionRoutes(router, deps);

    const req = createMockReq('GET', '/api/sessions');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(503);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('not configured');
  });

  it('GET /api/sessions/:id returns 404 when session not found', async () => {
    const router = new Router();
    const deps = {
      sessions: { loadSessionState: vi.fn(async () => null) },
    } as any;
    registerSessionRoutes(router, deps);

    const req = createMockReq('GET', '/api/sessions/nonexistent');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(404);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('not found');
  });

  it('GET /api/sessions/:id returns 404 when loadSessionState throws', async () => {
    const router = new Router();
    const deps = {
      sessions: { loadSessionState: vi.fn(async () => { throw new Error('corrupt'); }) },
    } as any;
    registerSessionRoutes(router, deps);

    const req = createMockReq('GET', '/api/sessions/bad-session');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(404);
  });

  it('GET /api/sessions/:id returns 503 when no session manager', async () => {
    const router = new Router();
    const deps = {} as any;
    registerSessionRoutes(router, deps);

    const req = createMockReq('GET', '/api/sessions/s1');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(503);
  });

  it('DELETE /api/sessions/:id returns 503 when no session manager', async () => {
    const router = new Router();
    const deps = {} as any;
    registerSessionRoutes(router, deps);

    const req = createMockReq('DELETE', '/api/sessions/s1');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(503);
  });

  it('GET /api/sessions returns empty list', async () => {
    const router = new Router();
    const deps = {
      sessions: { listSessions: vi.fn(async () => []) },
    } as any;
    registerSessionRoutes(router, deps);

    const req = createMockReq('GET', '/api/sessions');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.sessions).toEqual([]);
  });
});
