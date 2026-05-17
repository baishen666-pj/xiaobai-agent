import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { A2AServer } from '../../src/protocols/a2a/server.js';
import { A2AClient } from '../../src/protocols/a2a/client.js';

describe('A2A contextId session continuity', () => {
  let server: A2AServer;
  let client: A2AClient;
  const port = 4142;

  beforeEach(async () => {
    server = new A2AServer({ port });
    await server.start();
    client = new A2AClient(`http://localhost:${port}`);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('sends message without contextId', async () => {
    const response = await client.sendMessage('hello');
    expect(response).toBeDefined();
    if ('task' in response) {
      expect(response.task.id).toBeDefined();
    }
  });

  it('sends message with contextId', async () => {
    const response = await client.sendMessage('hello', { contextId: 'ctx-123' });
    expect(response).toBeDefined();
    if ('task' in response) {
      expect(response.task.id).toBeDefined();
    }
  });

  it('agent card version is 0.7.0', async () => {
    const card = await client.discover();
    expect(card.version).toBe('0.7.0');
  });
});
