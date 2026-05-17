import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  requestId: string;
  startTime: number;
}

export type Middleware = (ctx: RouteContext, next: () => Promise<void>) => Promise<void>;
export type RouteHandler = (ctx: RouteContext) => Promise<void>;

export interface RouteMetadata {
  summary?: string;
  description?: string;
  tags?: string[];
  requestBody?: { description: string };
  responses?: Record<number, { description: string }>;
}

interface Route {
  method: string;
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  metadata?: RouteMetadata;
}

export class Router {
  private routes: Route[] = [];
  private middleware: Middleware[] = [];

  use(middleware: Middleware): void {
    this.middleware.push(middleware);
  }

  get(path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
    this.addRoute('GET', path, handler, metadata);
  }

  post(path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
    this.addRoute('POST', path, handler, metadata);
  }

  put(path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
    this.addRoute('PUT', path, handler, metadata);
  }

  delete(path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
    this.addRoute('DELETE', path, handler, metadata);
  }

  getRoutes(): ReadonlyArray<Readonly<Route>> {
    return this.routes;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method?.toUpperCase() ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = path.match(route.regex);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      const query: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });

      let body: unknown = undefined;
      if (method === 'POST' || method === 'PUT') {
        const parsed = await this.parseBody(req);
        if (typeof parsed === 'symbol') {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          return true;
        }
        body = parsed;
      }

      const ctx: RouteContext = {
        req,
        res,
        params,
        query,
        body,
        requestId: randomUUID(),
        startTime: Date.now(),
      };

      await this.runMiddleware(ctx, route.handler);
      return true;
    }

    return false;
  }

  private async runMiddleware(ctx: RouteContext, handler: RouteHandler): Promise<void> {
    let index = 0;
    const middleware = [...this.middleware];

    const next = async (): Promise<void> => {
      if (index < middleware.length) {
        const mw = middleware[index++];
        await mw(ctx, next);
      } else {
        await handler(ctx);
      }
    };

    await next();
  }

  private async parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let oversized = false;
      const maxSize = 1024 * 1024; // 1MB

      req.on('data', (chunk: Buffer) => {
        if (oversized) return;
        size += chunk.length;
        if (size > maxSize) {
          oversized = true;
          resolve(Symbol('oversized'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!raw) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });

      req.on('error', () => resolve(undefined));
    });
  }

  private addRoute(method: string, pattern: string, handler: RouteHandler, metadata?: RouteMetadata): void {
    const paramNames: string[] = [];
    const regexStr = pattern.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.routes.push({
      method,
      pattern,
      regex: new RegExp(`^${regexStr}$`),
      paramNames,
      handler,
      metadata,
    });
  }
}
