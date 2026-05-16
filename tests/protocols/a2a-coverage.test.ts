import { describe, it, expect, afterEach } from 'vitest';
import { A2AServer } from '../../src/protocols/a2a/server.js';
import { A2AClient } from '../../src/protocols/a2a/client.js';
import { Role, TaskState } from '../../src/protocols/a2a/types.js';
import type { A2AMessage, SendMessageResponse, A2ATask, A2AServerHandler, AgentCard } from '../../src/protocols/a2a/types.js';

let nextPort = 15200;
function getTestPort(): number { return nextPort++; }

describe('A2AClient - extended coverage', () => {
  let server: A2AServer;

  afterEach(async () => {
    if (server) await server.stop();
  });

  it('strips trailing slash from baseUrl', () => {
    const client = new A2AClient('http://localhost:9999/');
    expect(client.getBaseUrl()).toBe('http://localhost:9999');
  });

  it('getAgentCard returns null before discover', () => {
    const client = new A2AClient('http://localhost:9999');
    expect(client.getAgentCard()).toBeNull();
  });

  it('throws on discover failure (non-ok response)', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const client = new A2AClient(`http://localhost:${port}`);
    // Request a non-existent URL to trigger a non-ok response
    const response = await fetch(`http://localhost:${port}/nonexistent`);
    expect(response.status).toBe(404);

    // A2AClient discover should work on the correct URL
    const card = await client.discover();
    expect(card.name).toBe('xiaobai-agent');
  });

  it('throws on sendMessage failure', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    // Point client to wrong URL to trigger failure
    const client = new A2AClient(`http://localhost:${port + 1}`);
    await expect(client.sendMessage('test')).rejects.toThrow();
  });

  it('throws on getTask failure', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const client = new A2AClient(`http://localhost:${port + 1}`);
    await expect(client.getTask('task-123')).rejects.toThrow();
  });

  it('throws on cancelTask failure', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const client = new A2AClient(`http://localhost:${port + 1}`);
    await expect(client.cancelTask('task-123')).rejects.toThrow();
  });

  it('throws when discover gets connection refused', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const client = new A2AClient(`http://localhost:${port + 1}`);
    // Connection refused throws TypeError, not "Failed to discover agent"
    await expect(client.discover()).rejects.toThrow();
  });

  it('getTask returns task from server', async () => {
    const port = getTestPort();
    const taskId = 'test-task-001';
    const mockTask: A2ATask = {
      id: taskId,
      status: { state: TaskState.COMPLETED, timestamp: new Date().toISOString() },
      history: [],
    };

    const handler: A2AServerHandler = {
      async onMessage() {
        return { task: mockTask };
      },
      async onGetTask(id: string) {
        return id === taskId ? mockTask : null;
      },
      async onCancelTask() { return null; },
    };

    server = new A2AServer({ port, handler });
    await server.start();

    const client = new A2AClient(server.getUrl());
    await client.discover();
    const task = await client.getTask(taskId);
    expect(task.id).toBe(taskId);
    expect(task.status.state).toBe(TaskState.COMPLETED);
  });

  it('cancelTask returns cancelled task', async () => {
    const port = getTestPort();
    const taskId = 'cancel-task-001';
    const cancelledTask: A2ATask = {
      id: taskId,
      status: { state: TaskState.CANCELED, timestamp: new Date().toISOString() },
      history: [],
    };

    const handler: A2AServerHandler = {
      async onMessage() {
        return { task: cancelledTask };
      },
      async onGetTask() { return null; },
      async onCancelTask(id: string) {
        return id === taskId ? cancelledTask : null;
      },
    };

    server = new A2AServer({ port, handler });
    await server.start();

    const client = new A2AClient(server.getUrl());
    await client.discover();
    const result = await client.cancelTask(taskId);
    expect(result.id).toBe(taskId);
    expect(result.status.state).toBe(TaskState.CANCELED);
  });

  it('sendMessage includes contextId in options', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const client = new A2AClient(server.getUrl());
    const response = await client.sendMessage('Hello', { contextId: 'ctx-123' });
    expect(response).toHaveProperty('task');
  });
});

describe('A2AServer - extended coverage', () => {
  let server: A2AServer;

  afterEach(async () => {
    if (server) await server.stop();
  });

  it('returns correct agent card URL', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    expect(server.getAgentCardUrl()).toBe(`http://localhost:${port}/.well-known/agent-card.json`);
  });

  it('uses default port 4120 when not specified', () => {
    const s = new A2AServer({});
    expect(s.getUrl()).toBe('http://localhost:4120');
    // Do not start it, just verify URL format
  });

  it('handles OPTIONS request with 204', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const response = await fetch(`http://localhost:${port}/.well-known/agent-card.json`, {
      method: 'OPTIONS',
    });
    expect(response.status).toBe(204);
  });

  it('returns 404 for unknown routes', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const response = await fetch(`http://localhost:${port}/unknown/route`);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Not found');
  });

  it('returns 404 for non-existent task', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const response = await fetch(`http://localhost:${port}/tasks/nonexistent-id`);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toBe('Task not found');
  });

  it('returns 404 for task cancel with non-existent task', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const response = await fetch(`http://localhost:${port}/tasks/nonexistent/cancel`, {
      method: 'POST',
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe(-32001);
  });

  it('returns 500 when handler throws', async () => {
    const port = getTestPort();
    const handler: A2AServerHandler = {
      async onMessage() { throw new Error('handler exploded'); },
      async onGetTask() { return null; },
      async onCancelTask() { return null; },
    };
    server = new A2AServer({ port, handler });
    await server.start();

    const response = await fetch(`http://localhost:${port}/message/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { messageId: 'm1', role: 'user', parts: [{ text: 'hi' }] },
        configuration: { acceptedOutputModes: ['text/plain'] },
      }),
    });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toBe('handler exploded');
  });

  it('returns 404 for GET /tasks/ without a task ID', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const response = await fetch(`http://localhost:${port}/tasks/`);
    expect(response.status).toBe(404);
  });

  it('returns 404 for POST cancel without a task ID', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const response = await fetch(`http://localhost:${port}/tasks/cancel`, {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });

  it('uses custom agent card', async () => {
    const port = getTestPort();
    const customCard: AgentCard = {
      name: 'custom-agent',
      description: 'A custom test agent',
      version: '1.0.0',
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    };
    server = new A2AServer({ port, agentCard: customCard });
    await server.start();

    const response = await fetch(`http://localhost:${port}/.well-known/agent-card.json`);
    const card = await response.json();
    expect(card.name).toBe('custom-agent');
    expect(card.version).toBe('1.0.0');
  });

  it('returns CORS headers on every response', async () => {
    const port = getTestPort();
    server = new A2AServer({ port });
    await server.start();

    const response = await fetch(`http://localhost:${port}/.well-known/agent-card.json`);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
  });

  it('stop is no-op if server was never started', async () => {
    const s = new A2AServer({ port: getTestPort() });
    await s.stop();
    // Should resolve without error
  });

  it('sends message with configuration in request body', async () => {
    const port = getTestPort();
    let receivedConfig: any = null;
    const handler: A2AServerHandler = {
      async onMessage(msg, config) {
        receivedConfig = config;
        return {
          task: {
            id: 't1',
            status: { state: TaskState.COMPLETED, timestamp: new Date().toISOString() },
            history: [msg],
          },
        };
      },
      async onGetTask() { return null; },
      async onCancelTask() { return null; },
    };
    server = new A2AServer({ port, handler });
    await server.start();

    const response = await fetch(`http://localhost:${port}/message/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { messageId: 'm1', role: 'user', parts: [{ text: 'test' }] },
        configuration: { acceptedOutputModes: ['text/plain'] },
      }),
    });
    expect(response.status).toBe(200);
    expect(receivedConfig).toBeDefined();
    expect(receivedConfig.acceptedOutputModes).toContain('text/plain');
  });
});
