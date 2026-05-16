import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  AgentCard,
  A2ATask,
  A2AMessage,
  SendMessageRequest,
  SendMessageResponse,
  TaskState,
  Role,
  Part,
} from './types.js';
import { TaskState as TS, Role as R } from './types.js';

export interface A2AServerHandler {
  onMessage(message: A2AMessage, config?: SendMessageRequest['configuration']): Promise<SendMessageResponse>;
  onGetTask(taskId: string): Promise<A2ATask | null>;
  onCancelTask(taskId: string): Promise<A2ATask | null>;
}

interface RouteContext {
  agentCard: AgentCard;
  handler: A2AServerHandler;
  tasks: Map<string, A2ATask>;
}

function buildDefaultAgentCard(): AgentCard {
  return {
    name: 'xiaobai-agent',
    description: 'Fusion AI agent with multi-agent orchestration, 18+ LLM providers, and MCP integration',
    version: '0.3.0',
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      { id: 'chat', name: 'Chat', description: 'General conversation and coding assistance', tags: ['chat', 'coding'] },
      { id: 'code-review', name: 'Code Review', description: 'Review code for quality, security, and best practices', tags: ['code-review', 'security'] },
    ],
  };
}

export class A2AServer {
  private server: ReturnType<typeof createServer> | null = null;
  private ctx: RouteContext;
  private port: number;

  constructor(options: { port?: number; agentCard?: AgentCard; handler?: A2AServerHandler }) {
    this.port = options.port ?? 4120;
    this.ctx = {
      agentCard: options.agentCard ?? buildDefaultAgentCard(),
      handler: options.handler ?? new DefaultHandler(),
      tasks: new Map(),
    };
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, () => resolve());
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => this.server!.close(() => resolve()));
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  getAgentCardUrl(): string {
    return `${this.getUrl()}/.well-known/agent-card.json`;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`);
    const method = req.method ?? 'GET';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') { res.writeHead(204).end(); return; }

    try {
      if (method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
        this.json(res, this.ctx.agentCard);
        return;
      }

      if (method === 'POST' && url.pathname === '/message/send') {
        const body = await this.readBody(req);
        const response = await this.ctx.handler.onMessage(body.message, body.configuration);
        this.json(res, response);
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/tasks/')) {
        const taskId = url.pathname.split('/tasks/')[1]?.split('/')[0];
        if (taskId) {
          const task = await this.ctx.handler.onGetTask(taskId);
          if (task) { this.json(res, task); return; }
        }
        this.json(res, { error: { code: -32001, message: 'Task not found' } }, 404);
        return;
      }

      if (method === 'POST' && url.pathname.includes('/cancel')) {
        const taskId = url.pathname.split('/tasks/')[1]?.split('/')[0];
        if (taskId) {
          const task = await this.ctx.handler.onCancelTask(taskId);
          if (task) { this.json(res, task); return; }
        }
        this.json(res, { error: { code: -32001, message: 'Task not found' } }, 404);
        return;
      }

      this.json(res, { error: 'Not found' }, 404);
    } catch (err) {
      this.json(res, { error: { code: -32603, message: (err as Error).message } }, 500);
    }
  }

  private json(res: ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private readBody(req: IncomingMessage): Promise<SendMessageRequest> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }
}

class DefaultHandler implements A2AServerHandler {
  async onMessage(message: A2AMessage): Promise<SendMessageResponse> {
    const taskId = randomUUID();
    const task: A2ATask = {
      id: taskId,
      status: { state: TS.COMPLETED, timestamp: new Date().toISOString() },
      history: [message],
    };
    return { task };
  }

  async onGetTask(): Promise<A2ATask | null> { return null; }
  async onCancelTask(): Promise<A2ATask | null> { return null; }
}
