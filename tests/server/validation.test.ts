import { describe, it, expect, vi } from 'vitest';
import { validateBody, validateQuery, sendJson } from '../../src/server/validation.js';
import { z } from 'zod';
import type { RouteContext } from '../../src/server/router.js';

function createMockCtx(overrides: Partial<RouteContext> = {}): RouteContext {
  let ended = false;
  let body = '';
  const res = {
    headersSent: false,
    writeHead: vi.fn(function (this: any, status: number, hdrs?: Record<string, string>) {
      this.statusCode = status;
      if (hdrs) Object.assign(this.headers, hdrs);
    }),
    end: vi.fn(function (this: any, data?: string) {
      ended = true;
      body = typeof data === 'string' ? data : '';
    }),
    setHeader: vi.fn(),
    statusCode: 200,
    headers: {} as Record<string, string>,
  } as any;

  return {
    req: {} as any,
    res,
    params: {},
    query: {},
    body: undefined,
    requestId: 'test-req-id',
    startTime: Date.now(),
    ...overrides,
  } as RouteContext;
}

describe('validateBody', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('rejects null body with 400', async () => {
    const middleware = validateBody(schema);
    const ctx = createMockCtx({ body: null });
    const next = vi.fn();

    await middleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
    const call = ctx.res.end.mock.calls[0];
    const parsed = JSON.parse(call[0]);
    expect(parsed.error).toBe('Request body required');
  });

  it('rejects undefined body with 400', async () => {
    const middleware = validateBody(schema);
    const ctx = createMockCtx({ body: undefined });
    const next = vi.fn();

    await middleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
  });

  it('rejects invalid body with 400 and error details', async () => {
    const middleware = validateBody(schema);
    const ctx = createMockCtx({ body: { name: 123 } });
    const next = vi.fn();

    await middleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const call = ctx.res.end.mock.calls[0];
    const parsed = JSON.parse(call[0]);
    expect(parsed.error).toBe('Validation failed');
    expect(parsed.details).toBeDefined();
    expect(parsed.details.length).toBeGreaterThan(0);
  });

  it('passes valid body and sets validated.body', async () => {
    const middleware = validateBody(schema);
    const ctx = createMockCtx({ body: { name: 'Alice', age: 30 } });
    const next = vi.fn();

    await middleware(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect((ctx as any).validated.body).toEqual({ name: 'Alice', age: 30 });
  });

  it('preserves existing validated fields', async () => {
    const middleware = validateBody(schema);
    const ctx = createMockCtx({ body: { name: 'Bob', age: 25 } });
    (ctx as any).validated = { query: { page: 1 } };

    await middleware(ctx, vi.fn());

    expect((ctx as any).validated.query).toEqual({ page: 1 });
    expect((ctx as any).validated.body).toEqual({ name: 'Bob', age: 25 });
  });
});

describe('validateQuery', () => {
  const schema = z.object({ page: z.coerce.number(), limit: z.coerce.number().optional() });

  it('rejects invalid query with 400 and error details', async () => {
    const middleware = validateQuery(schema);
    const ctx = createMockCtx({ query: {} });
    const next = vi.fn();

    await middleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    const call = ctx.res.end.mock.calls[0];
    const parsed = JSON.parse(call[0]);
    expect(parsed.error).toBe('Invalid query parameters');
    expect(parsed.details).toBeDefined();
  });

  it('passes valid query and sets validated.query', async () => {
    const middleware = validateQuery(schema);
    const ctx = createMockCtx({ query: { page: '2', limit: '10' } });
    const next = vi.fn();

    await middleware(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect((ctx as any).validated.query).toEqual({ page: 2, limit: 10 });
  });

  it('preserves existing validated fields', async () => {
    const middleware = validateQuery(schema);
    const ctx = createMockCtx({ query: { page: '1' } });
    (ctx as any).validated = { body: { name: 'test' } };

    await middleware(ctx, vi.fn());

    expect((ctx as any).validated.body).toEqual({ name: 'test' });
    expect((ctx as any).validated.query).toEqual({ page: 1 });
  });
});

describe('sendJson', () => {
  it('writes status and JSON body', () => {
    const ctx = createMockCtx();

    sendJson(ctx, 200, { success: true });

    expect(ctx.res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    const call = ctx.res.end.mock.calls[0];
    expect(JSON.parse(call[0])).toEqual({ success: true });
  });

  it('writes error response with different status', () => {
    const ctx = createMockCtx();

    sendJson(ctx, 500, { error: 'Something went wrong' });

    expect(ctx.res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
    const call = ctx.res.end.mock.calls[0];
    expect(JSON.parse(call[0]).error).toBe('Something went wrong');
  });

  it('does nothing if headers already sent', () => {
    const ctx = createMockCtx();
    ctx.res.headersSent = true;

    sendJson(ctx, 200, { data: 'test' });

    expect(ctx.res.writeHead).not.toHaveBeenCalled();
    expect(ctx.res.end).not.toHaveBeenCalled();
  });

  it('serializes null values', () => {
    const ctx = createMockCtx();

    sendJson(ctx, 204, null);

    const call = ctx.res.end.mock.calls[0];
    expect(call[0]).toBe('null');
  });

  it('serializes arrays', () => {
    const ctx = createMockCtx();

    sendJson(ctx, 200, [1, 2, 3]);

    const call = ctx.res.end.mock.calls[0];
    expect(JSON.parse(call[0])).toEqual([1, 2, 3]);
  });
});
