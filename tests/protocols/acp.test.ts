import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ACPAdapter } from '../../src/protocols/acp/adapter.js';
import { XiaobaiAgent, type AgentDeps } from '../../src/core/agent.js';

function createMockAgent(): XiaobaiAgent {
  const mockDeps = {
    config: {
      get: vi.fn().mockReturnValue({
        provider: { default: 'openai' },
        model: { default: 'gpt-4' },
        context: { maxTurns: 10 },
        memory: { enabled: false },
        sandbox: { enabled: false },
        skills: { enabled: false },
        plugins: { enabled: false },
      }),
      getConfigDir: vi.fn().mockReturnValue('/tmp/test'),
    },
    provider: {
      chat: vi.fn().mockResolvedValue({ content: 'Hello!', usage: { totalTokens: 10 } }),
      chatStream: vi.fn(),
      updateConfig: vi.fn(),
    },
    tools: {
      registerBatch: vi.fn(),
      getToolDefinitions: vi.fn().mockReturnValue([
        { name: 'read', description: 'Read file', parameters: { type: 'object', properties: {} } },
      ]),
      execute: vi.fn(),
      list: vi.fn().mockReturnValue(['read']),
      has: vi.fn().mockReturnValue(false),
    },
    sessions: {
      createSession: vi.fn().mockReturnValue('test-session'),
      loadMessages: vi.fn().mockResolvedValue([]),
      saveMessages: vi.fn().mockResolvedValue(undefined),
      saveSessionState: vi.fn().mockResolvedValue(undefined),
      loadSessionState: vi.fn().mockResolvedValue(null),
    },
    hooks: { emit: vi.fn().mockResolvedValue({ exitCode: 'ok' }) },
    memory: { getSystemPromptBlock: vi.fn().mockResolvedValue(null), flushIfDirty: vi.fn().mockResolvedValue(undefined) },
    security: { checkPermission: vi.fn().mockResolvedValue(true) },
  } as unknown as AgentDeps;

  return new XiaobaiAgent(mockDeps);
}

describe('ACPAdapter', () => {
  let adapter: ACPAdapter;
  let agent: XiaobaiAgent;
  let port: number;

  beforeAll(async () => {
    agent = await createMockAgent();
    port = 14120 + Math.floor(Math.random() * 100);
    adapter = new ACPAdapter({ agent, port });
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  it('returns correct URL', () => {
    expect(adapter.getUrl()).toBe(`http://localhost:${port}`);
  });

  it('handles initialize request', async () => {
    const res = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    const data = await res.json();
    expect(data.result.name).toBe('xiaobai-agent');
    expect(data.result.capabilities.streaming).toBe(true);
  });

  it('handles task/start request', async () => {
    const res = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'task/start', params: { prompt: 'Hello' } }),
    });
    const data = await res.json();
    expect(data.result.success).toBe(true);
    expect(typeof data.result.output).toBe('string');
  });

  it('handles OPTIONS with CORS', async () => {
    const res = await fetch(`http://localhost:${port}`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rejects non-POST requests', async () => {
    const res = await fetch(`http://localhost:${port}`, { method: 'GET' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it('rejects invalid JSON-RPC', async () => {
    const res = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 3, method: 'test' }),
    });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32600);
  });

  it('rejects unknown methods', async () => {
    const res = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'unknown/method', params: {} }),
    });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toContain('Unknown method');
  });

  it('handles task/cancel for non-existent task', async () => {
    const res = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'task/cancel', params: { taskId: 'nonexistent' } }),
    });
    const data = await res.json();
    expect(data.result.cancelled).toBe(false);
  });

  it('handles permission/response', async () => {
    const res = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'permission/response', params: { id: 'test-perm', allowed: true } }),
    });
    const data = await res.json();
    expect(data.result.ok).toBe(true);
  });

  it('handles shutdown gracefully', async () => {
    const res = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'shutdown' }),
    });
    const data = await res.json();
    expect(data.result).toBeNull();
  });
});
