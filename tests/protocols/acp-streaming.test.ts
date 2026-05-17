import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ACPAdapter } from '../../src/protocols/acp/adapter.js';
import type { XiaobaiAgent } from '../../src/core/agent.js';

function createMockAgent(): XiaobaiAgent {
  return {
    chatSync: async () => 'mock response',
    getCurrentModel: () => ({ model: 'test-model' }),
    getTools: () => ({ getToolDefinitions: () => [] }),
    setModel: () => {},
  } as unknown as XiaobaiAgent;
}

describe('ACP Streaming', () => {
  let adapter: ACPAdapter;
  const port = 4150;

  beforeEach(async () => {
    adapter = new ACPAdapter({ port, agent: createMockAgent() });
    await adapter.start();
  });

  afterEach(async () => {
    await adapter.stop();
  });

  it('task/stream returns SSE events', async () => {
    const response = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'task/stream',
        params: { prompt: 'hello' },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const text = await response.text();
    expect(text).toContain('task/message');
    expect(text).toContain('task/complete');
  });

  it('task/stream includes working status first', async () => {
    const response = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'task/stream',
        params: { prompt: 'test' },
      }),
    });

    const text = await response.text();
    expect(text).toContain('working');
  });
});
