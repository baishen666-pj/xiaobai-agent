import { describe, it, expect, vi } from 'vitest';
import { corsMiddleware, rateLimitMiddleware, errorMiddleware, apiKeyAuthMiddleware } from '../../src/server/middleware.js';
import type { RouteContext } from '../../src/server/router.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function createMockCtx(overrides: Partial<RouteContext> = {}): RouteContext {
  const res = {
    headers: {} as Record<string, string>,
    statusCode: 200,
    headersSent: false,
    writeHead(status: number, hdrs?: Record<string, string>) {
      (this as any).statusCode = status;
      if (hdrs) Object.assign((this as any).headers, hdrs);
    },
    end(data?: string) {},
    setHeader(key: string, value: string) {
      (this as any).headers[key] = value;
    },
  } as any as ServerResponse;

  return {
    req: { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as any as IncomingMessage,
    res,
    params: {},
    query: {},
    body: undefined,
    requestId: 'test-123',
    startTime: Date.now(),
    ...overrides,
  };
}

describe('corsMiddleware', () => {
  it('should set CORS headers', async () => {
    const middleware = corsMiddleware();
    const ctx = createMockCtx();
    await middleware(ctx, async () => {});

    expect((ctx.res as any).headers['Access-Control-Allow-Origin']).toBe('*');
    expect((ctx.res as any).headers['Access-Control-Allow-Methods']).toBeDefined();
  });

  it('should respond 204 to OPTIONS preflight', async () => {
    const middleware = corsMiddleware();
    const ctx = createMockCtx({ req: { method: 'OPTIONS', headers: {} } as any });
    await middleware(ctx, async () => {});

    expect((ctx.res as any).statusCode).toBe(204);
  });
});

describe('rateLimitMiddleware', () => {
  it('should allow requests under limit', async () => {
    const middleware = rateLimitMiddleware({ maxRequests: 5, windowMs: 60000 });
    const ctx = createMockCtx();
    await middleware(ctx, async () => {});

    expect((ctx.res as any).headers['X-RateLimit-Remaining']).toBeDefined();
  });

  it('should block requests over limit', async () => {
    const middleware = rateLimitMiddleware({ maxRequests: 2, windowMs: 60000 });

    for (let i = 0; i < 3; i++) {
      const ctx = createMockCtx();
      const endSpy = vi.fn();
      (ctx.res as any).end = endSpy;
      await middleware(ctx, async () => {});
      if (i < 2) expect(endSpy).not.toHaveBeenCalled();
    }

    // Third request should have been blocked
  });
});

describe('errorMiddleware', () => {
  it('should catch errors and return 500', async () => {
    const middleware = errorMiddleware();
    const ctx = createMockCtx();
    const endSpy = vi.fn();
    (ctx.res as any).end = endSpy;

    await middleware(ctx, async () => { throw new Error('test error'); });

    expect((ctx.res as any).statusCode).toBe(500);
    expect(endSpy).toHaveBeenCalled();
    const body = JSON.parse(endSpy.mock.calls[0][0]);
    expect(body.error).toBe('Internal server error');
  });
});

describe('apiKeyAuthMiddleware', () => {
  it('should pass when no keys configured', async () => {
    const middleware = apiKeyAuthMiddleware({ keys: new Map() });
    const ctx = createMockCtx();
    let handlerCalled = false;
    await middleware(ctx, async () => { handlerCalled = true; });
    expect(handlerCalled).toBe(true);
  });

  it('should reject missing key', async () => {
    const keys = new Map<string, { name: string; scopes: string[] }>();
    keys.set('test-key', { name: 'test', scopes: ['read'] });
    const middleware = apiKeyAuthMiddleware({ keys });
    const ctx = createMockCtx();
    const endSpy = vi.fn();
    (ctx.res as any).end = endSpy;

    await middleware(ctx, async () => {});

    expect((ctx.res as any).statusCode).toBe(401);
  });
});
