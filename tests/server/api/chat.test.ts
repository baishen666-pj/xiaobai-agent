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

  it('POST /api/chat should return 400 when message is empty string', async () => {
    const router = new Router();
    const deps = { provider: { chat: vi.fn() } } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat', { message: '' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/chat should return 503 when no provider configured', async () => {
    const router = new Router();
    const deps = {} as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat', { message: 'Hello' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(503);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('No provider');
  });

  it('POST /api/chat should return 500 when provider throws', async () => {
    const router = new Router();
    const deps = {
      provider: { chat: vi.fn(async () => { throw new Error('Provider error'); }) },
    } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat', { message: 'Hello' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(500);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe('Provider error');
  });

  it('POST /api/chat should handle object response from provider', async () => {
    const router = new Router();
    const deps = {
      provider: { chat: vi.fn(async () => ({ content: 'object response' })) },
    } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat', { message: 'Hello' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.content).toBe('object response');
  });

  it('POST /api/chat should use provided model in response', async () => {
    const router = new Router();
    const deps = {
      provider: { chat: vi.fn(async () => 'response') },
    } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat', { message: 'Hello', model: 'gpt-4' });
    const res = createMockRes();
    await router.handle(req, res);

    const parsed = JSON.parse(res.body);
    expect(parsed.model).toBe('gpt-4');
  });

  it('POST /api/chat uses default model when not specified', async () => {
    const router = new Router();
    const deps = {
      provider: { chat: vi.fn(async () => 'hi') },
    } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat', { message: 'Hello' });
    const res = createMockRes();
    await router.handle(req, res);

    const parsed = JSON.parse(res.body);
    expect(parsed.model).toBe('default');
    expect(parsed.timestamp).toBeDefined();
  });

  it('POST /api/chat/stream should return SSE events', async () => {
    const router = new Router();
    const chunks: string[] = [];
    const deps = {
      provider: {
        chatStream: vi.fn(async function* () {
          yield { type: 'text', content: 'Hello' };
          yield { type: 'text', content: ' world' };
        }),
      },
    } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat/stream', { message: 'Hello' });
    const res = createMockRes();
    (res as any).write = (data: string) => chunks.push(data);
    (res as any).writableEnded = false;

    await router.handle(req, res);

    expect(chunks.length).toBeGreaterThan(0);
    const combined = chunks.join('');
    expect(combined).toContain('Hello');
    expect(combined).toContain('[DONE]');
  });

  it('POST /api/chat/stream should return 400 for invalid body', async () => {
    const router = new Router();
    const deps = { provider: { chat: vi.fn() } } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat/stream', {});
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/chat/stream should return 503 when no provider', async () => {
    const router = new Router();
    const deps = {} as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat/stream', { message: 'test' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(503);
  });

  it('POST /api/chat/stream falls back to chat when no chatStream', async () => {
    const router = new Router();
    const chunks: string[] = [];
    const deps = {
      provider: { chat: vi.fn(async () => 'fallback response') },
    } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat/stream', { message: 'Hello' });
    const res = createMockRes();
    (res as any).write = (data: string) => chunks.push(data);
    (res as any).writableEnded = false;

    await router.handle(req, res);

    const combined = chunks.join('');
    expect(combined).toContain('fallback response');
    expect(combined).toContain('[DONE]');
  });

  it('POST /api/chat/stream handles provider error gracefully', async () => {
    const router = new Router();
    const chunks: string[] = [];
    const deps = {
      provider: {
        chatStream: vi.fn(async function* () {
          throw new Error('stream error');
        }),
      },
    } as any;
    registerChatRoutes(router, deps);

    const req = createMockReq('POST', '/api/chat/stream', { message: 'Hello' });
    const res = createMockRes();
    (res as any).write = (data: string) => chunks.push(data);
    (res as any).writableEnded = false;

    await router.handle(req, res);

    const combined = chunks.join('');
    expect(combined).toContain('stream error');
    expect(combined).toContain('[DONE]');
  });
});
