import { describe, it, expect, vi } from 'vitest';
import { registerChatRoutes } from '../../../src/server/api/chat.js';
import { Router } from '../../../src/server/router.js';
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

function createMockRes() {
  let body = '';
  const headers: Record<string, string> = {};
  return {
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
    write(data: string) {},
  } as any;
}

describe('Chat API', () => {
  it('POST /api/chat should return response', async () => {
    const router = new Router();
    const deps = {
      provider: { chat: vi.fn(async () => 'Hello from AI') },
    } as any;

    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat', { message: 'Hello' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.content).toBe('Hello from AI');
  });

  it('POST /api/chat should return 400 for invalid body', async () => {
    const router = new Router();
    const deps = { provider: { chat: vi.fn() } } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat', {});
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(400);
  });
});
