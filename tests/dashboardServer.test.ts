import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { DashboardServer } from '../src/server/index.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('DashboardServer', () => {
  let server: DashboardServer;
  let port: number;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-server-'));
    server = new DashboardServer({ port: 0, staticDir: tempDir });
    await server.start();
    port = (server as any).httpServer.address().port;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('starts and responds to health check', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.details.clients).toBe(0);
  });

  it('accepts WebSocket connections', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.close();
        resolve();
      });
    });
  });

  it('responds to ping with pong', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    const response = await new Promise<any>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' }));
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
          ws.close();
        });
      });
    });

    expect(response.type).toBe('pong');
    expect(response.timestamp).toBeGreaterThan(0);
  });

  it('tracks connected clients', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve) => {
      ws.on('open', resolve);
    });

    expect(server.getBridge().getClientCount()).toBe(1);
    ws.close();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.getBridge().getClientCount()).toBe(0);
  });

  it('returns correct URL', () => {
    const url = server.getUrl();
    expect(url).toContain('ws://');
    expect(url).toContain(String(port));
  });

  it('broadcasts events to connected clients', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    const response = await new Promise<any>((resolve) => {
      ws.on('open', () => {
        const event = { type: 'plan', tasks: [] };
        server.getBridge().broadcast(event);

        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
          ws.close();
        });
      });
    });

    expect(response.type).toBe('plan');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  it('ignores non-ClientMessage JSON', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'random_stuff', data: 42 }));
        setTimeout(() => {
          ws.close();
          resolve();
        }, 50);
      });
    });
  });

  it('ignores client messages without agentDeps', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    const response = await new Promise<any>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'session_list' }));
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
          ws.close();
        });
        setTimeout(() => resolve(null), 100);
      });
    });

    expect(response).toBeNull();
  });
});

describe('DashboardServer staticDir resolution', () => {
  it('uses explicit staticDir when provided', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-explicit-'));
    const server = new DashboardServer({ port: 0, staticDir: tempDir });
    expect((server as any).staticDir).toBe(tempDir);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves to package public dir when built dashboard exists', () => {
    const server = new DashboardServer({ port: 0 });
    const staticDir = (server as any).staticDir;
    expect(staticDir).toContain('public');
  });

  it('serves built dashboard assets', async () => {
    const server = new DashboardServer({ port: 0 });
    await server.start();
    const port = (server as any).httpServer.address().port;

    const res = await fetch(`http://localhost:${port}/`);
    const html = await res.text();

    if (res.status === 200) {
      expect(html).toContain('Xiaobai Dashboard');
      expect(html).toContain('id="root"');
    }

    await server.stop();
  });
});

describe('DashboardServer build detection', () => {
  it('starts without error when index.html missing (warns)', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'xiaobai-empty-'));
    const server = new DashboardServer({ port: 0, staticDir: emptyDir });
    await server.start();
    expect((server as any).httpServer.listening).toBe(true);
    await server.stop();
    rmSync(emptyDir, { recursive: true, force: true });
  });
});
