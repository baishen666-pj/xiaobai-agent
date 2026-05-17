import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { A2AServer, XiaobaiAgentHandler } from '../../src/protocols/a2a/server.js';
import { A2AClient } from '../../src/protocols/a2a/client.js';
import type { ServerResponse } from 'node:http';

describe('A2A Streaming', () => {
  let server: A2AServer;
  let client: A2AClient;
  const port = 4140;

  beforeEach(async () => {
    server = new A2AServer({ port });
    await server.start();
    client = new A2AClient(`http://localhost:${port}`);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('returns streaming not supported for default handler', async () => {
    const response = await fetch(`http://localhost:${port}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { messageId: '1', role: 'user', parts: [{ text: 'hello' }] },
      }),
    });
    expect(response.status).toBe(501);
  });

  it('handles SSE stream route with custom handler', async () => {
    let streamCalled = false;
    const handler = {
      async onMessage() { return { task: { id: '1', status: { state: 'completed' } } }; },
      async onStreamMessage(_msg: unknown, res: ServerResponse) {
        streamCalled = true;
        res.write('event: status\ndata: {"state":"working"}\n\n');
        res.write('event: task_update\ndata: {"id":"1","status":{"state":"completed"}}\n\n');
      },
      async onGetTask() { return null; },
      async onCancelTask() { return null; },
    };

    await server.stop();
    server = new A2AServer({ port, handler });
    await server.start();

    const response = await fetch(`http://localhost:${port}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { messageId: '1', role: 'user', parts: [{ text: 'test' }] },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(streamCalled).toBe(true);
  });
});
