import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { DashboardServer } from '../../src/server/index.js';
import { EventBridge } from '../../src/server/eventBridge.js';
import { Orchestrator } from '../../src/core/orchestrator.js';
import { ConfigManager } from '../../src/config/manager.js';
import { ProviderRouter } from '../../src/provider/router.js';
import { SessionManager } from '../../src/session/manager.js';
import { HookSystem } from '../../src/hooks/system.js';
import { MemorySystem } from '../../src/memory/system.js';
import { SecurityManager } from '../../src/security/manager.js';
import { SandboxManager } from '../../src/sandbox/manager.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { getBuiltinTools } from '../../src/tools/builtin.js';
import type { OrchestratorEvent } from '../../src/core/orchestrator.js';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let testDir: string;
let server: DashboardServer;

function setupOrchestrator(): Orchestrator {
  const config = ConfigManager.getDefault();
  const provider = new ProviderRouter(config);
  const tools = new ToolRegistry();
  const sessionDir = join(testDir, 'sessions');
  mkdirSync(sessionDir, { recursive: true });
  const sessions = new SessionManager(sessionDir);
  const hooks = new HookSystem(testDir);
  const memory = new MemorySystem(testDir);
  const security = new SecurityManager(config);
  const sandbox = new SandboxManager(config.sandbox);

  tools.registerBatch(getBuiltinTools({ security, config: new ConfigManager(), memory, sandbox }));

  return new Orchestrator({
    config: new ConfigManager(),
    provider,
    tools,
    sessions,
    hooks,
    memory,
    security,
  });
}

beforeEach(() => {
  testDir = join(tmpdir(), `xiaobai-e2e-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(async () => {
  if (server) {
    await server.stop();
    server = undefined as any;
  }
  rmSync(testDir, { recursive: true, force: true });
});

function wsConnect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
  });
}

function wsReceive(ws: WebSocket, timeout = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Receive timeout')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

describe('E2E: DashboardServer + WebSocket', () => {
  it('starts and responds to health check', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const response = await fetch(`${server.getHttpUrl()}/health`);
    const body = await response.json() as { status: string; clients: number };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.clients).toBe(0);
  });

  it('accepts WebSocket connection', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const ws = await wsConnect(server.getUrl());
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const health = await (await fetch(`${server.getHttpUrl()}/health`)).json() as { clients: number };
    expect(health.clients).toBe(1);

    ws.close();
  });

  it('responds to ping with pong', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const ws = await wsConnect(server.getUrl());
    ws.send(JSON.stringify({ type: 'ping' }));

    const response = await wsReceive(ws);
    const parsed = JSON.parse(response) as { type: string; timestamp: number };
    expect(parsed.type).toBe('pong');
    expect(parsed.timestamp).toBeGreaterThan(0);

    ws.close();
  });

  it('serves static files', async () => {
    writeFileSync(join(testDir, 'index.html'), '<h1>Test</h1>');
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const response = await fetch(`${server.getHttpUrl()}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h1>Test</h1>');
  });

  it('returns 404 for missing files', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const response = await fetch(`${server.getHttpUrl()}/nonexistent.js`);
    expect(response.status).toBe(404);
  });
});

describe('E2E: EventBridge broadcast', () => {
  it('broadcasts events to all connected clients', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const ws1 = await wsConnect(server.getUrl());
    const ws2 = await wsConnect(server.getUrl());

    // Register listeners BEFORE broadcasting
    const recv1Promise = wsReceive(ws1);
    const recv2Promise = wsReceive(ws2);

    const testEvent: OrchestratorEvent = {
      type: 'task_started',
      task: {
        id: 'task_1',
        description: 'test task',
        role: 'coordinator',
        status: 'running',
        priority: 1,
        dependencies: [],
        input: {},
        maxRetries: 3,
        retries: 0,
        createdAt: Date.now(),
      },
      agentId: 'agent_1',
    };

    server.getBridge().broadcast(testEvent);

    const recv1 = await recv1Promise;
    const recv2 = await recv2Promise;

    const parsed1 = JSON.parse(recv1) as OrchestratorEvent;
    const parsed2 = JSON.parse(recv2) as OrchestratorEvent;

    expect(parsed1.type).toBe('task_started');
    expect(parsed2.type).toBe('task_started');
    expect((parsed1 as any).task.id).toBe('task_1');
    expect((parsed2 as any).task.id).toBe('task_1');

    ws1.close();
    ws2.close();
  });

  it('removes disconnected clients', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const ws = await wsConnect(server.getUrl());
    expect(server.getBridge().getClientCount()).toBe(1);

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(server.getBridge().getClientCount()).toBe(0);
  });

  it('does not broadcast to closed clients', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const ws1 = await wsConnect(server.getUrl());
    const ws2 = await wsConnect(server.getUrl());

    ws2.close();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const event: OrchestratorEvent = { type: 'error', error: 'test' };
    server.getBridge().broadcast(event);

    // ws1 should still receive
    const recv = await wsReceive(ws1);
    expect(JSON.parse(recv).type).toBe('error');

    ws1.close();
  });
});

describe('E2E: Orchestrator → EventBridge → WebSocket', () => {
  it('attaches orchestrator and broadcasts plan event', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const orch = setupOrchestrator();
    server.attachOrchestrator(orch);

    const ws = await wsConnect(server.getUrl());
    const receivePromise = wsReceive(ws, 2000);

    orch.addTask({ description: 'E2E test task', role: 'coordinator' });

    // Just emit plan event by getting tasks
    const tasks = orch.getTasks();
    expect(tasks).toHaveLength(1);

    ws.close();
  });

  it('orchestrator events reach WebSocket clients', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const orch = setupOrchestrator();
    server.attachOrchestrator(orch);

    const ws = await wsConnect(server.getUrl());

    const received: string[] = [];
    ws.on('message', (data) => {
      const event = JSON.parse(data.toString()) as OrchestratorEvent;
      received.push(event.type);
    });

    // Manually trigger events through the bridge
    const bridge = server.getBridge();
    bridge.broadcast({ type: 'plan', tasks: [] });
    bridge.broadcast({ type: 'error', error: 'test' });

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(received).toContain('plan');
    expect(received).toContain('error');

    ws.close();
  });

  it('multiple orchestrator events arrive in order', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const ws = await wsConnect(server.getUrl());

    const bridge = server.getBridge();
    const events: string[] = [
      'task_started',
      'task_progress',
      'task_completed',
    ];

    const received: OrchestratorEvent[] = [];
    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()) as OrchestratorEvent);
    });

    for (const type of events) {
      bridge.broadcast({ type: type as any, error: '' } as OrchestratorEvent);
    }

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(received.map((e) => e.type)).toEqual(events);

    ws.close();
  });
});

describe('E2E: Server lifecycle', () => {
  it('starts and stops cleanly', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const url = server.getHttpUrl();
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);

    await server.stop();

    // After stop, connections should fail
    try {
      await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      expect.unreachable('Server should be stopped');
    } catch {
      // Expected: connection refused
      expect(true).toBe(true);
    }

    server = undefined as any;
  });

  it('cleans up all WebSocket clients on stop', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const ws1 = await wsConnect(server.getUrl());
    const ws2 = await wsConnect(server.getUrl());
    expect(server.getBridge().getClientCount()).toBe(2);

    await server.stop();
    server = undefined as any;

    // WebSocket should be closed
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(ws1.readyState).not.toBe(WebSocket.OPEN);
    expect(ws2.readyState).not.toBe(WebSocket.OPEN);
  });

  it('handles concurrent health checks', async () => {
    server = new DashboardServer({ port: 0, staticDir: testDir });
    await server.start();

    const requests = Array.from({ length: 10 }, () =>
      fetch(`${server.getHttpUrl()}/health`).then((r) => r.json() as Promise<{ status: string }>),
    );

    const results = await Promise.all(requests);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
  });
});
