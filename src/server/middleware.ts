import type { RouteContext, Middleware } from './router.js';

export interface CorsOptions {
  origins?: string[];
  methods?: string[];
  headers?: string[];
  maxAge?: number;
}

export function corsMiddleware(options?: CorsOptions): Middleware {
  const origins = options?.origins ?? ['*'];
  const methods = options?.methods ?? ['GET', 'POST', 'PUT', 'DELETE'];
  const headers = options?.headers ?? ['Content-Type', 'Authorization', 'X-API-Key'];
  const maxAge = options?.maxAge ?? 86400;

  return async (ctx, next) => {
    ctx.res.setHeader('Access-Control-Allow-Origin', origins.join(', '));
    ctx.res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
    ctx.res.setHeader('Access-Control-Allow-Headers', headers.join(', '));
    ctx.res.setHeader('Access-Control-Max-Age', String(maxAge));

    if (ctx.req.method === 'OPTIONS') {
      ctx.res.writeHead(204);
      ctx.res.end();
      return;
    }

    await next();
  };
}

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyFn?: (ctx: RouteContext) => string;
}

export function rateLimitMiddleware(options?: RateLimitOptions): Middleware {
  const windowMs = options?.windowMs ?? 60000;
  const maxRequests = options?.maxRequests ?? 100;
  const keyFn = options?.keyFn ?? ((ctx) =>
    ctx.req.headers['x-api-key'] as string ?? ctx.req.socket.remoteAddress ?? 'unknown'
  );

  const buckets = new Map<string, { count: number; resetAt: number }>();

  return async (ctx, next) => {
    const key = keyFn(ctx);
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    ctx.res.setHeader('X-RateLimit-Limit', String(maxRequests));
    ctx.res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - bucket.count)));
    ctx.res.setHeader('X-RateLimit-Reset', String(bucket.resetAt));

    if (bucket.count > maxRequests) {
      ctx.res.writeHead(429, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }

    await next();
  };
}

export function requestLogMiddleware(): Middleware {
  return async (ctx, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(`[api] ${ctx.req.method} ${ctx.req.url} ${ctx.res.statusCode} ${duration}ms`);
  };
}

export function errorMiddleware(): Middleware {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error('[api] Error:', err);
      if (!ctx.res.headersSent) {
        ctx.res.writeHead(500, { 'Content-Type': 'application/json' });
        ctx.res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  };
}

export interface ApiKeyConfig {
  keys: Map<string, { name: string; scopes: string[] }>;
  headerName?: string;
}

export function apiKeyAuthMiddleware(config: ApiKeyConfig): Middleware {
  const headerName = config.headerName ?? 'x-api-key';

  return async (ctx, next) => {
    if (config.keys.size === 0) {
      await next();
      return;
    }

    const key = (ctx.req.headers[headerName] as string) ?? ctx.query.api_key;
    if (!key) {
      ctx.res.writeHead(401, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ error: 'API key required' }));
      return;
    }

    const entry = config.keys.get(key);
    if (!entry) {
      ctx.res.writeHead(403, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ error: 'Invalid API key' }));
      return;
    }

    (ctx as any).apiKey = entry;
    await next();
  };
}
