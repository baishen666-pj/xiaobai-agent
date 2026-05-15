import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { EventBridge } from '../src/server/eventBridge.js';
import type { OrchestratorEvent } from '../src/core/orchestrator.js';

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.on('open', () => resolve());
  });
}

describe('EventBridge', () => {
  it('starts with zero clients', () => {
    const bridge = new EventBridge();
    expect(bridge.getClientCount()).toBe(0);
  });

  it('tracks connected clients', () => {
    const bridge = new EventBridge();
    const ws = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn(), close: vi.fn() } as any;

    bridge.addClient(ws);
    expect(bridge.getClientCount()).toBe(1);
  });

  it('removes client on close', () => {
    const bridge = new EventBridge();
    const closeHandlers: (() => void)[] = [];
    const ws = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'close') closeHandlers.push(handler);
      }),
      close: vi.fn(),
    } as any;

    bridge.addClient(ws);
    expect(bridge.getClientCount()).toBe(1);

    for (const handler of closeHandlers) handler();
    expect(bridge.getClientCount()).toBe(0);
  });

  it('broadcasts events to all clients', () => {
    const bridge = new EventBridge();
    const ws1 = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn(), close: vi.fn() } as any;
    const ws2 = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn(), close: vi.fn() } as any;

    bridge.addClient(ws1);
    bridge.addClient(ws2);

    const event: OrchestratorEvent = { type: 'plan', tasks: [] as any };
    bridge.broadcast(event);

    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(event));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(event));
  });

  it('skips non-open clients during broadcast', () => {
    const bridge = new EventBridge();
    const wsOpen = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn(), close: vi.fn() } as any;
    const wsClosed = { readyState: 3, OPEN: 1, send: vi.fn(), on: vi.fn(), close: vi.fn() } as any;

    bridge.addClient(wsOpen);
    bridge.addClient(wsClosed);

    bridge.broadcast({ type: 'all_completed', results: [] });

    expect(wsOpen.send).toHaveBeenCalled();
    expect(wsClosed.send).not.toHaveBeenCalled();
    expect(bridge.getClientCount()).toBe(1);
  });

  it('closes all clients', () => {
    const bridge = new EventBridge();
    const ws1 = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn(), close: vi.fn() } as any;
    const ws2 = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn(), close: vi.fn() } as any;

    bridge.addClient(ws1);
    bridge.addClient(ws2);
    bridge.close();

    expect(ws1.close).toHaveBeenCalled();
    expect(ws2.close).toHaveBeenCalled();
    expect(bridge.getClientCount()).toBe(0);
  });

  it('creates orchestrator listener that broadcasts', () => {
    const bridge = new EventBridge();
    const ws = { readyState: 1, OPEN: 1, send: vi.fn(), on: vi.fn(), close: vi.fn() } as any;
    bridge.addClient(ws);

    const listener = bridge.createOrchestratorListener();
    const event: OrchestratorEvent = { type: 'task_started', task: { id: 't1' } as any, agentId: 'a1' };
    listener(event);

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(event));
  });
});

describe('EventBridge integration', () => {
  let server: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    port = (server.address() as any).port;
  });

  afterEach(() => {
    server.close();
  });

  it('integrates with real WebSocket', async () => {
    const bridge = new EventBridge();

    server.on('connection', (ws) => {
      bridge.addClient(ws);
    });

    const received: string[] = [];
    const client = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>((resolve) => {
      client.on('open', () => resolve());
    });

    client.on('message', (data) => {
      received.push(data.toString());
    });

    const event: OrchestratorEvent = { type: 'all_completed', results: [] };
    bridge.broadcast(event);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0])).toEqual(event);

    client.close();
    bridge.close();
  });
});
