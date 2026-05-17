import type { Middleware, RouteContext } from './router.js';
import type { ZodSchema } from 'zod';

export function validateBody(schema: ZodSchema): Middleware {
  return async (ctx, next) => {
    if (ctx.body === undefined || ctx.body === null) {
      ctx.res.writeHead(400, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ error: 'Request body required' }));
      return;
    }

    const result = schema.safeParse(ctx.body);
    if (!result.success) {
      ctx.res.writeHead(400, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ error: 'Validation failed', details: result.error.issues }));
      return;
    }

    (ctx as any).validated = { ...(ctx as any).validated, body: result.data };
    await next();
  };
}

export function validateQuery(schema: ZodSchema): Middleware {
  return async (ctx, next) => {
    const result = schema.safeParse(ctx.query);
    if (!result.success) {
      ctx.res.writeHead(400, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ error: 'Invalid query parameters', details: result.error.issues }));
      return;
    }

    (ctx as any).validated = { ...(ctx as any).validated, query: result.data };
    await next();
  };
}

export function sendJson(ctx: RouteContext, status: number, data: unknown): void {
  if (!ctx.res.headersSent) {
    ctx.res.writeHead(status, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(data));
  }
}
