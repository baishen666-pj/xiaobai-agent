import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { A2AServer } from '../../src/protocols/a2a/server.js';
import { A2AClient } from '../../src/protocols/a2a/client.js';

describe('A2A tasks/list', () => {
  let server: A2AServer;
  let client: A2AClient;
  const port = 4141;

  beforeEach(async () => {
    server = new A2AServer({ port });
    await server.start();
    client = new A2AClient(`http://localhost:${port}`);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('GET /tasks returns empty tasks list', async () => {
    const result = await client.listTasks();
    expect(result.tasks).toBeDefined();
    expect(Array.isArray(result.tasks)).toBe(true);
  });

  it('GET /tasks with status filter', async () => {
    const result = await client.listTasks({ status: 'completed' });
    expect(result.tasks).toBeDefined();
  });

  it('GET /tasks with pagination', async () => {
    const result = await client.listTasks({ limit: 10, offset: 0 });
    expect(result.tasks).toBeDefined();
  });

  it('returns tasks from handler', async () => {
    await server.stop();
    const handler = {
      async onMessage() { return { task: { id: '1', status: { state: 'completed' } } }; },
      async onGetTask() { return null; },
      async onCancelTask() { return null; },
      async onListTasks(filter?: { status?: string; limit?: number; offset?: number }) {
        return [
          { id: '1', status: { state: 'completed' } },
          { id: '2', status: { state: 'working' } },
        ].filter(t => !filter?.status || t.status.state === filter.status);
      },
    };
    server = new A2AServer({ port, handler });
    await server.start();

    const all = await client.listTasks();
    expect(all.tasks.length).toBe(2);

    const completed = await client.listTasks({ status: 'completed' });
    expect(completed.tasks.length).toBe(1);
  });
});
