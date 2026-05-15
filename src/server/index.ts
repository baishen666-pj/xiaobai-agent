import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBridge } from './eventBridge.js';
import type { Orchestrator, OrchestratorEvent } from '../core/orchestrator.js';

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
}

export class DashboardServer {
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private bridge: EventBridge;
  private port: number;
  private host: string;
  private staticDir: string;

  constructor(options: DashboardServerOptions = {}) {
    this.port = options.port ?? 3001;
    this.host = options.host ?? '0.0.0.0';
    this.staticDir = resolveStaticDir(options.staticDir);
    this.bridge = new EventBridge();

    this.httpServer = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      this.bridge.addClient(ws);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch {}
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url?.split('?')[0] ?? '/';

    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', clients: this.bridge.getClientCount() }));
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
        } catch {}
      }
      res.writeHead(404);
      res.end();
    }
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
}
