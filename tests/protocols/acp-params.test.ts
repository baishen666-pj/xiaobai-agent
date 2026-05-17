import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ACPAdapter } from '../../src/protocols/acp/adapter.js';
import type { XiaobaiAgent } from '../../src/core/agent.js';

let setModelCalls: string[] = [];

function createMockAgent(): XiaobaiAgent {
  setModelCalls = [];
  return {
    chatSync: async () => 'mock response',
    getCurrentModel: () => ({ model: 'test-model' }),
    getTools: () => ({ getToolDefinitions: () => [] }),
    setModel: (model: string) => { setModelCalls.push(model); },
  } as unknown as XiaobaiAgent;
}

describe('ACP Parameter Support', () => {
  let adapter: ACPAdapter;
  const port = 4151;

  beforeEach(async () => {
    adapter = new ACPAdapter({ port, agent: createMockAgent() });
    await adapter.start();
  });

  afterEach(async () => {
    await adapter.stop();
  });

  it('honors model parameter', async () => {
    const response = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'task/start',
        params: { prompt: 'hello', model: 'gpt-4' },
      }),
    });

    const data = await response.json() as { result?: { success?: boolean } };
    expect(data.result?.success).toBe(true);
    expect(setModelCalls).toContain('gpt-4');
  });

  it('returns success in task result', async () => {
    const response = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'task/start',
        params: { prompt: 'hello' },
      }),
    });

    const data = await response.json() as { result?: { success?: boolean; output?: string } };
    expect(data.result?.success).toBe(true);
    expect(data.result?.output).toBe('mock response');
  });

  it('initialize returns version 0.7.0', async () => {
    const response = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
      }),
    });

    const data = await response.json() as { result?: { version?: string } };
    expect(data.result?.version).toBe('0.7.0');
  });

  it('task/start without model works', async () => {
    const response = await fetch(`http://localhost:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'task/start',
        params: { prompt: 'no model' },
      }),
    });

    const data = await response.json() as { result?: { success?: boolean } };
    expect(data.result?.success).toBe(true);
    expect(setModelCalls.length).toBe(0);
  });
});
