import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { DashboardServer } from '../src/server/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
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
    expect(data.status).toBe('ok');
    expect(data.clients).toBe(0);
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
});
