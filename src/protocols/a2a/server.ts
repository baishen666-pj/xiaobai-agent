import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  AgentCard,
  A2ATask,
  A2AMessage,
  SendMessageRequest,
  SendMessageResponse,
} from './types.js';
import { TaskState as TS, Role } from './types.js';
import type { XiaobaiAgent } from '../../core/agent.js';
import { createAuthChecker, type AuthConfig } from '../../security/auth.js';

export interface A2AServerHandler {
  onMessage(message: A2AMessage, config?: SendMessageRequest['configuration']): Promise<SendMessageResponse>;
  onStreamMessage?(message: A2AMessage, res: ServerResponse): Promise<void>;
  onGetTask(taskId: string): Promise<A2ATask | null>;
  onListTasks?(filter?: { status?: string; limit?: number; offset?: number }): Promise<A2ATask[]>;
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
    version: '0.7.0',
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
  private checkAuth: (req: IncomingMessage) => boolean;

  constructor(options: { port?: number; agentCard?: AgentCard; handler?: A2AServerHandler; auth?: AuthConfig }) {
    this.port = options.port ?? 4120;
    this.checkAuth = createAuthChecker(options.auth ?? {});
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

    const isPublic = method === 'GET' && url.pathname === '/.well-known/agent-card.json';
    if (!isPublic && !this.checkAuth(req)) {
      this.json(res, { error: { code: -32000, message: 'Unauthorized' } }, 401);
      return;
    }

    try {
      if (method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
        this.json(res, this.ctx.agentCard);
        return;
      }

      if (method === 'POST' && url.pathname === '/message/stream') {
        if (this.ctx.handler.onStreamMessage) {
          const body = await this.readBody(req);
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          await this.ctx.handler.onStreamMessage(body.message, res);
          res.end();
        } else {
          this.json(res, { error: { code: -32601, message: 'Streaming not supported' } }, 501);
        }
        return;
      }

      if (method === 'POST' && url.pathname === '/message/send') {
        const body = await this.readBody(req);
        const response = await this.ctx.handler.onMessage(body.message, body.configuration);
        this.json(res, response);
        return;
      }

      if (method === 'GET' && url.pathname === '/tasks') {
        if (this.ctx.handler.onListTasks) {
          const status = url.searchParams.get('status') ?? undefined;
          const limit = url.searchParams.has('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;
          const offset = url.searchParams.has('offset') ? parseInt(url.searchParams.get('offset')!, 10) : undefined;
          const tasks = await this.ctx.handler.onListTasks({ status, limit, offset });
          this.json(res, { tasks });
        } else {
          this.json(res, { tasks: Array.from(this.ctx.tasks.values()) });
        }
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

function sendSSE(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export class XiaobaiAgentHandler implements A2AServerHandler {
  private agent: XiaobaiAgent;
  private tasks = new Map<string, A2ATask>();
  private cancelledTasks = new Set<string>();
  private contextSessions = new Map<string, string>();

  constructor(agent: XiaobaiAgent) {
    this.agent = agent;
  }

  async onMessage(message: A2AMessage, config?: SendMessageRequest['configuration']): Promise<SendMessageResponse> {
    const taskId = randomUUID();

    const text = message.parts
      .map((p) => p.text ?? '')
      .filter(Boolean)
      .join('\n');

    if (!text.trim()) {
      const task: A2ATask = {
        id: taskId,
        status: { state: TS.FAILED, timestamp: new Date().toISOString() },
        history: [message],
      };
      this.tasks.set(taskId, task);
      return { task };
    }

    let sessionId: string | undefined;
    if (config?.contextId) {
      sessionId = this.contextSessions.get(config.contextId);
      if (!sessionId) {
        sessionId = randomUUID();
        this.contextSessions.set(config.contextId, sessionId);
      }
    }

    const workingTask: A2ATask = {
      id: taskId,
      contextId: config?.contextId,
      status: { state: TS.WORKING, timestamp: new Date().toISOString() },
      history: [message],
    };
    this.tasks.set(taskId, workingTask);

    try {
      const output = await this.agent.chatSync(text);

      if (this.cancelledTasks.has(taskId)) {
        workingTask.status = { state: TS.CANCELED, timestamp: new Date().toISOString() };
        this.cancelledTasks.delete(taskId);
        return { task: workingTask };
      }

      workingTask.status = { state: TS.COMPLETED, timestamp: new Date().toISOString() };
      workingTask.history = [
        message,
        {
          messageId: randomUUID(),
          role: Role.AGENT,
          parts: [{ text: output }],
        },
      ];
    } catch (error) {
      workingTask.status = {
        state: TS.FAILED,
        timestamp: new Date().toISOString(),
        message: {
          messageId: randomUUID(),
          role: Role.AGENT,
          parts: [{ text: `Error: ${(error as Error).message}` }],
        },
      };
    }

    return { task: workingTask };
  }

  async onStreamMessage(message: A2AMessage, res: ServerResponse): Promise<void> {
    const taskId = randomUUID();
    const text = message.parts.map((p) => p.text ?? '').filter(Boolean).join('\n');

    if (!text.trim()) {
      sendSSE(res, 'status', { taskId, state: 'failed' });
      return;
    }

    sendSSE(res, 'status', { taskId, state: 'working' });

    try {
      const output = await this.agent.chatSync(text);

      const task: A2ATask = {
        id: taskId,
        status: { state: TS.COMPLETED, timestamp: new Date().toISOString() },
        history: [
          message,
          { messageId: randomUUID(), role: Role.AGENT, parts: [{ text: output }] },
        ],
      };
      this.tasks.set(taskId, task);

      sendSSE(res, 'task_update', task);
      sendSSE(res, 'status', { taskId, state: 'completed' });
    } catch (error) {
      sendSSE(res, 'status', { taskId, state: 'failed', error: (error as Error).message });
    }
  }

  async onGetTask(taskId: string): Promise<A2ATask | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async onListTasks(filter?: { status?: string; limit?: number; offset?: number }): Promise<A2ATask[]> {
    let tasks = Array.from(this.tasks.values());
    if (filter?.status) {
      tasks = tasks.filter(t => t.status.state === filter.status);
    }
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 50;
    return tasks.slice(offset, offset + limit);
  }

  async onCancelTask(taskId: string): Promise<A2ATask | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    this.cancelledTasks.add(taskId);
    task.status = { state: TS.CANCELED, timestamp: new Date().toISOString() };
    return task;
  }
}
