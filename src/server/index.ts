import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBridge } from './eventBridge.js';
import type { SSEClient } from './eventBridge.js';
import type { Orchestrator, OrchestratorEvent } from '../core/orchestrator.js';
import { createAuthChecker, type AuthConfig } from '../security/auth.js';
import { isClientMessage, type ClientMessage } from './client-messages.js';
import { AgentSession } from './agent-session.js';
import type { AgentDeps } from '../core/agent.js';
import type { LoopEvent } from '../core/loop.js';
import type { Tracer } from '../telemetry/tracer.js';
import { GracefulShutdown, type Shutdownable } from './graceful.js';
import { HealthChecker } from './health.js';
import type { ApiGateway } from './gateway.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveStaticDir(explicit?: string): string {
  if (explicit) return explicit;
  const candidates = [
    join(__dirname, '..', '..', 'public'),
    join(process.cwd(), 'public'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return candidates[0];
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export interface DashboardServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  auth?: AuthConfig;
  agentDeps?: AgentDeps;
  sseEnabled?: boolean;
  sseHeartbeatMs?: number;
  tracer?: Tracer;
}

export class DashboardServer {
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private bridge: EventBridge;
  private port: number;
  private host: string;
  private staticDir: string;
  private checkAuth: (req: IncomingMessage) => boolean;
  private agentDeps?: AgentDeps;
  private clientSessions = new Map<import('ws').WebSocket, AgentSession>();
  private sseEnabled: boolean;
  private sseHeartbeatMs: number;
  private sseClientIdCounter = 0;
  private tracer?: Tracer;
  private healthChecker: HealthChecker;
  private gateway?: ApiGateway;

  constructor(options: DashboardServerOptions = {}) {
    this.port = options.port ?? 3001;
    this.host = options.host ?? '0.0.0.0';
    this.staticDir = resolveStaticDir(options.staticDir);
    this.checkAuth = createAuthChecker(options.auth ?? {});
    this.bridge = new EventBridge();
    this.agentDeps = options.agentDeps;
    this.sseEnabled = options.sseEnabled ?? false;
    this.sseHeartbeatMs = options.sseHeartbeatMs ?? 30000;
    this.tracer = options.tracer;
    this.healthChecker = new HealthChecker(options.agentDeps);

    this.httpServer = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws, req) => {
      if (!this.checkAuth(req as any)) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      this.bridge.addClient(ws);

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            return;
          }

          if (!isClientMessage(msg)) return;

          const session = this.clientSessions.get(ws);
          if (session) {
            const ack = await session.handleClientMessage(msg as ClientMessage);
            if (ack) ws.send(JSON.stringify(ack));
            return;
          }

          if (!this.agentDeps) return;

          if (msg.type === 'task_start' || msg.type === 'session_create') {
            const newSession = new AgentSession(this.agentDeps, '', (event) => {
              this.bridge.broadcast(this.toChatEvent(newSession.getSessionId(), event));
            });
            this.clientSessions.set(ws, newSession);
            const ack = await newSession.handleClientMessage(msg as ClientMessage);
            if (ack) ws.send(JSON.stringify(ack));
          }
        } catch (err) { console.error('[server] Error:', err); }
      });

      ws.on('close', () => {
        const session = this.clientSessions.get(ws);
        if (session) {
          session.destroy();
          this.clientSessions.delete(ws);
        }
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url?.split('?')[0] ?? '/';

    // Liveness probe must be accessible without auth for health checks
    if (url === '/health/live') {
      const result = this.healthChecker.liveness();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (!this.checkAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (this.gateway) {
      const handled = await this.gateway.getRouter().handle(req, res);
      if (handled) return;
    }

    if (url === '/health') {
      const result = await this.healthChecker.check();
      result.details = { ...result.details, clients: this.bridge.getClientCount() };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (url === '/health/ready') {
      const { ready, checks } = await this.healthChecker.readiness();
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready, checks }));
      return;
    }

    if (url === '/events' && this.sseEnabled) {
      this.handleSSE(req, res);
      return;
    }

    if (url === '/api/traces') {
      this.handleTraces(req, res);
      return;
    }

    const filePath = join(this.staticDir, url === '/' ? 'index.html' : url);
    const resolvedPath = resolve(filePath);
    const resolvedStaticDir = resolve(this.staticDir);

    if (!resolvedPath.startsWith(resolvedStaticDir + sep) && resolvedPath !== resolvedStaticDir) {
      res.writeHead(403);
      res.end();
      return;
    }

    try {
      const data = await readFile(filePath);
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    } catch {
      if (existsSync(join(this.staticDir, 'index.html')) && !url.startsWith('/api')) {
        try {
          const indexData = await readFile(join(this.staticDir, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexData);
          return;
        } catch (err) { console.error('[server] Error:', err); }
      }
      res.writeHead(404);
      res.end();
    }
  }

  private handleSSE(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const clientId = `sse-${++this.sseClientIdCounter}`;
    const lastEventIdRaw = _req.headers['last-event-id'];
    const lastEventIdStr = Array.isArray(lastEventIdRaw) ? lastEventIdRaw[0] : lastEventIdRaw;
    const lastEventId = lastEventIdStr ? parseInt(lastEventIdStr, 10) : undefined;

    const client: SSEClient = {
      id: clientId,
      res,
      lastEventId: isNaN(lastEventId as number) ? undefined : lastEventId,
    };

    this.bridge.addSSEClient(client);

    res.write(': connected\n\n');

    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(': heartbeat\n\n');
      }
    }, this.sseHeartbeatMs);

    _req.on('close', () => {
      clearInterval(heartbeat);
      this.bridge.removeSSEClient(clientId);
    });
  }

  private handleTraces(_req: IncomingMessage, res: ServerResponse): void {
    const url = _req.url ?? '/api/traces';
    const params = new URL(url, `http://${_req.headers.host}`).searchParams;
    const limit = parseInt(params.get('limit') ?? '20', 10) || 20;

    if (!this.tracer) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tracer not configured' }));
      return;
    }

    const traces = this.tracer.getRecentTraces(limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(traces));
  }

  setTracer(tracer: Tracer): void {
    this.tracer = tracer;
  }

  setGateway(gateway: ApiGateway): void {
    this.gateway = gateway;
  }

  attachOrchestrator(orchestrator: Orchestrator): () => void {
    const listener = (event: OrchestratorEvent) => {
      this.bridge.broadcast(event);
    };
    return orchestrator.onEvent(listener);
  }

  async start(): Promise<void> {
    const indexExists = existsSync(join(this.staticDir, 'index.html'));
    if (!indexExists) {
      console.warn(
        `[dashboard] No built dashboard found at ${this.staticDir}\n` +
        `[dashboard] Run "npm run build:dashboard" first, or use --static-dir to specify a path.`,
      );
    }

    return new Promise((resolve) => {
      this.httpServer.listen(this.port, this.host, () => {
        const addr = this.httpServer.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.bridge.close();
    this.wss.close();
    return new Promise((resolve) => {
      this.httpServer.close(() => resolve());
    });
  }

  registerShutdownHooks(deps?: AgentDeps): () => void {
    const shutdown = new GracefulShutdown();
    const self: Shutdownable = { name: 'server', stop: () => this.stop() };
    shutdown.register(self);

    if (deps?.plugins) {
      shutdown.register({ name: 'plugins', stop: () => deps.plugins!.deactivateAll() });
    }
    if (deps?.mcp) {
      shutdown.register({ name: 'mcp', stop: () => deps.mcp!.disconnectAll() });
    }

    return shutdown.install();
  }

  getBridge(): EventBridge {
    return this.bridge;
  }

  getUrl(): string {
    return `ws://localhost:${this.port}`;
  }

  getHttpUrl(): string {
    return `http://localhost:${this.port}`;
  }

  getPort(): number {
    return this.port;
  }

  private toChatEvent(sessionId: string, event: LoopEvent): any {
    switch (event.type) {
      case 'text':
      case 'stream':
        return { type: 'chat_turn', sessionId, content: event.content, tokens: event.tokens ?? 0 };
      case 'tool_call':
        return { type: 'chat_tool_call', sessionId, toolName: event.toolName ?? 'unknown' };
      case 'tool_result':
        return { type: 'chat_tool_result', sessionId, toolName: event.toolName ?? 'unknown', success: event.result?.success ?? false, output: event.content };
      case 'stop':
        return { type: 'chat_stop', sessionId, reason: event.content, totalTokens: event.tokens ?? 0 };
      case 'error':
        return { type: 'chat_error', sessionId, error: event.content };
      default:
        return { type: 'chat_turn', sessionId, content: event.content, tokens: event.tokens ?? 0 };
    }
  }

}
