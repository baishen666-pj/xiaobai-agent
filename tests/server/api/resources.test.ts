import { describe, it, expect, vi } from 'vitest';
import { registerResourceRoutes } from '../../../src/server/api/resources.js';
import { Router } from '../../../src/server/router.js';
import type { IncomingMessage } from 'node:http';

vi.mock('../../../src/provider/router.js', () => ({
  ProviderRouter: {
    getAvailableProviders: vi.fn(() => ['anthropic', 'openai']),
  },
}));

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

describe('Resource API', () => {
  it('GET /api/models should list providers', async () => {
    const router = new Router();
    const deps = {} as any;
    registerResourceRoutes(router, deps);

    const req = createMockReq('GET', '/api/models');
    const res = createMockRes();
    await router.handle(req, res);

    const parsed = JSON.parse(res.body);
    expect(parsed.providers).toEqual(['anthropic', 'openai']);
  });

  it('GET /api/tools should list tools', async () => {
    const router = new Router();
    const deps = { tools: { getToolDefinitions: vi.fn(() => [{ name: 'bash' }]) } } as any;
    registerResourceRoutes(router, deps);

    const req = createMockReq('GET', '/api/tools');
    const res = createMockRes();
    await router.handle(req, res);

    const parsed = JSON.parse(res.body);
    expect(parsed.tools).toHaveLength(1);
  });

  it('GET /api/plugins should list plugins', async () => {
    const router = new Router();
    const deps = { plugins: { list: vi.fn(() => [{ name: 'p1', state: 'activated' }]) } } as any;
    registerResourceRoutes(router, deps);

    const req = createMockReq('GET', '/api/plugins');
    const res = createMockRes();
    await router.handle(req, res);

    const parsed = JSON.parse(res.body);
    expect(parsed.plugins).toHaveLength(1);
  });
});
