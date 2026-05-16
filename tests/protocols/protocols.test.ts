import { describe, it, expect, afterEach } from 'vitest';
import { A2AServer } from '../../src/protocols/a2a/server.js';
import { A2AClient } from '../../src/protocols/a2a/client.js';
import { Role, TaskState } from '../../src/protocols/a2a/types.js';
import { LocalMemoryBackend, Mem0Backend, createMemoryBackend } from '../../src/memory/mem0-adapter.js';
import { ACPAdapter } from '../../src/protocols/acp/adapter.js';

let nextPort = 14200;
function getTestPort(): number { return nextPort++; }

describe('A2A Server + Client', () => {
  let server: A2AServer;

  afterEach(async () => {
    if (server) await server.stop();
  });

  it('starts and returns agent card', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const client = new A2AClient(server.getUrl());
    const card = await client.discover();

    expect(card.name).toBe('xiaobai-agent');
    expect(card.version).toBe('0.5.0');
    expect(card.skills.length).toBeGreaterThan(0);
  });

  it('sends a message and gets a task response', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const client = new A2AClient(server.getUrl());
    const response = await client.sendMessage('Hello, agent!');

    expect(response).toHaveProperty('task');
    if ('task' in response) {
      expect(response.task.id).toBeTruthy();
      expect(response.task.status.state).toBe(TaskState.COMPLETED);
    }
  });

  it('client stores discovered agent card', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const client = new A2AClient(server.getUrl());
    await client.discover();

    expect(client.getAgentCard()).not.toBeNull();
    expect(client.getBaseUrl()).toBe(server.getUrl());
  });
});

describe('LocalMemoryBackend', () => {
  it('adds and lists entries', async () => {
    const backend = new LocalMemoryBackend();
    await backend.add('long-term', 'user prefers dark mode');
    await backend.add('long-term', 'user codes in TypeScript');

    const items = await backend.list('long-term');
    expect(items).toContain('user prefers dark mode');
    expect(items).toContain('user codes in TypeScript');
  });

  it('prevents exact duplicates', async () => {
    const backend = new LocalMemoryBackend();
    await backend.add('state', 'name: Alice');
    await backend.add('state', 'name: Alice');

    const items = await backend.list('state');
    expect(items.length).toBe(1);
  });

  it('removes an entry', async () => {
    const backend = new LocalMemoryBackend();
    await backend.add('state', 'to-remove');
    const result = await backend.remove('state', 'to-remove');
    expect(result.success).toBe(true);

    const items = await backend.list('state');
    expect(items).toHaveLength(0);
  });

  it('replaces an entry', async () => {
    const backend = new LocalMemoryBackend();
    await backend.add('long-term', 'old content');
    await backend.replace('long-term', 'old', 'new content');

    const items = await backend.list('long-term');
    expect(items).toContain('new content');
    expect(items).not.toContain('old content');
  });

  it('returns null prompt block when empty', async () => {
    const backend = new LocalMemoryBackend();
    const block = await backend.getSystemPromptBlock();
    expect(block).toBeNull();
  });

  it('returns formatted prompt block', async () => {
    const backend = new LocalMemoryBackend();
    await backend.add('long-term', 'test memory');
    const block = await backend.getSystemPromptBlock();
    expect(block).toContain('test memory');
    expect(block).toContain('LONG-TERM');
  });

  it('respects char limit', async () => {
    const backend = new LocalMemoryBackend(10);
    const result = await backend.add('state', 'a'.repeat(20));
    expect(result.success).toBe(false);
    expect(result.error).toContain('char limit');
  });
});

describe('createMemoryBackend', () => {
  it('creates local backend by default', () => {
    const backend = createMemoryBackend();
    expect(backend).toBeInstanceOf(LocalMemoryBackend);
  });

  it('creates mem0 backend when configured', () => {
    const backend = createMemoryBackend({
      backend: 'mem0',
      mem0: { apiKey: 'test-key' },
    });
    expect(backend).toBeInstanceOf(Mem0Backend);
  });

  it('falls back to local when mem0 has no apiKey', () => {
    const backend = createMemoryBackend({
      backend: 'mem0',
      mem0: { apiKey: '' },
    });
    expect(backend).toBeInstanceOf(LocalMemoryBackend);
  });
});

describe('ACPAdapter', () => {
  it('has correct URL format', () => {
    // Test without starting the server (avoids port binding issues)
    const mockAgent = { getCurrentModel: () => ({ provider: 'test', model: 'test' }), getTools: () => ({ getToolDefinitions: () => [] }) } as any;
    const adapter = new ACPAdapter({ port: 9999, agent: mockAgent });
    expect(adapter.getUrl()).toBe('http://localhost:9999');
  });
});
