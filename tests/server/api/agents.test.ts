import { describe, it, expect, vi } from 'vitest';
import { registerAgentRoutes } from '../../../src/server/api/agents.js';
import { Router } from '../../../src/server/router.js';
import type { IncomingMessage } from 'node:http';

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
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    headersSent: false,
    writeHead(status: number, hdrs?: Record<string, string>) {
      (this as any).statusCode = status;
      if (hdrs) Object.assign((this as any).headers, hdrs);
    },
    end(data?: string) {
      (this as any).body = typeof data === 'string' ? data : '';
    },
    setHeader() {},
    write() {},
  } as any;
}

function createMockBridge() {
  const agents = new Map<string, any>();

  return {
    registerAgent: vi.fn(async (config: any) => {
      agents.set(config.name, config);
    }),
    unregisterAgent: vi.fn((name: string) => {
      agents.delete(name);
    }),
    getAgent: vi.fn((name: string) => agents.get(name)),
    listAgents: vi.fn(() => Array.from(agents.values())),
    executeRemoteTask: vi.fn(async (name: string, prompt: string) => ({
      success: true,
      output: `Executed: ${prompt}`,
      tokensUsed: 50,
    })),
  };
}

function createMockMarketplace() {
  const entries = [
    { id: 'm1', name: 'Reviewer Bot', description: 'Reviews code', protocol: 'a2a' as const, url: 'http://localhost:4000', author: 'test', version: '1.0.0', rating: 4.5, verified: true, tags: ['code'] },
    { id: 'm2', name: 'Analyst Bot', description: 'Analyzes data', protocol: 'acp' as const, url: 'http://localhost:5000', author: 'test', version: '1.0.0', rating: 4.0, verified: false, tags: ['data'] },
  ];

  return {
    search: vi.fn((query: string) => entries.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))),
    browse: vi.fn((tag?: string) => tag ? entries.filter((e) => e.tags.includes(tag)) : entries),
    install: vi.fn(async (id: string) => {
      const found = entries.find((e) => e.id === id);
      if (!found) return { success: false, error: `Entry "${id}" not found` };
      return { success: true };
    }),
  };
}

describe('Agent API Routes', () => {
  it('GET /api/agents returns list from bridge.listAgents()', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    // Register an agent first
    await bridge.registerAgent({ name: 'test-agent', url: 'http://localhost:3000', protocol: 'a2a' });

    const req = createMockReq('GET', '/api/agents');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0].name).toBe('test-agent');
    expect(bridge.listAgents).toHaveBeenCalled();
  });

  it('POST /api/agents/register validates and calls bridge.registerAgent()', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('POST', '/api/agents/register', {
      name: 'new-agent',
      url: 'http://localhost:3000',
      protocol: 'a2a',
      role: 'reviewer',
    });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(parsed.name).toBe('new-agent');
    expect(bridge.registerAgent).toHaveBeenCalledWith({
      name: 'new-agent',
      url: 'http://localhost:3000',
      protocol: 'a2a',
      role: 'reviewer',
    });
  });

  it('POST /api/agents/register returns 400 if missing params', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('POST', '/api/agents/register', { name: 'only-name' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('required');
  });

  it('POST /api/agents/register returns 400 for invalid protocol', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('POST', '/api/agents/register', {
      name: 'agent',
      url: 'http://localhost:3000',
      protocol: 'invalid',
    });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('protocol');
  });

  it('DELETE /api/agents/:name unregisters', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    await bridge.registerAgent({ name: 'removable-agent', url: 'http://localhost:3000', protocol: 'a2a' });

    const req = createMockReq('DELETE', '/api/agents/removable-agent');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(bridge.unregisterAgent).toHaveBeenCalledWith('removable-agent');
  });

  it('DELETE /api/agents/:name returns 404 if not found', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('DELETE', '/api/agents/nonexistent');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(404);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('not found');
  });

  it('POST /api/agents/:name/execute executes task', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    await bridge.registerAgent({ name: 'exec-agent', url: 'http://localhost:3000', protocol: 'a2a' });

    const req = createMockReq('POST', '/api/agents/exec-agent/execute', { prompt: 'Do something' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(parsed.output).toContain('Do something');
    expect(bridge.executeRemoteTask).toHaveBeenCalledWith('exec-agent', 'Do something');
  });

  it('POST /api/agents/:name/execute returns 400 without prompt', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    await bridge.registerAgent({ name: 'exec-agent', url: 'http://localhost:3000', protocol: 'a2a' });

    const req = createMockReq('POST', '/api/agents/exec-agent/execute', {});
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('prompt');
  });

  it('POST /api/agents/:name/execute returns 404 for unknown agent', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('POST', '/api/agents/unknown/execute', { prompt: 'Do something' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(404);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('not found');
  });

  it('GET /api/agents/marketplace returns entries', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('GET', '/api/agents/marketplace');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.entries).toHaveLength(2);
    expect(marketplace.browse).toHaveBeenCalled();
  });

  it('GET /api/agents/marketplace searches with query param', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('GET', '/api/agents/marketplace?q=reviewer');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    expect(marketplace.search).toHaveBeenCalledWith('reviewer');
  });

  it('GET /api/agents/marketplace browses with tag param', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('GET', '/api/agents/marketplace?tag=code');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    expect(marketplace.browse).toHaveBeenCalledWith('code');
  });

  it('POST /api/agents/marketplace/:id/install calls marketplace.install', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('POST', '/api/agents/marketplace/m1/install');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(marketplace.install).toHaveBeenCalledWith('m1');
  });

  it('POST /api/agents/marketplace/:id/install returns 400 on failure', async () => {
    const router = new Router();
    const bridge = createMockBridge();
    const marketplace = createMockMarketplace();
    registerAgentRoutes(router, bridge as any, marketplace as any);

    const req = createMockReq('POST', '/api/agents/marketplace/nonexistent/install');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toContain('not found');
  });
});
