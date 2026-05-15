import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  ACPRequest,
  ACPResponse,
  ACPAgentInfo,
  ACPTaskParams,
  ACPTaskResult,
  ACPPermissionRequest,
} from './types.js';
import { XiaobaiAgent } from '../../core/agent.js';

export interface ACPAdapterOptions {
  port?: number;
  agent: XiaobaiAgent;
}

interface PendingPermission {
  resolve: (allowed: boolean) => void;
}

export class ACPAdapter {
  private server: ReturnType<typeof createServer> | null = null;
  private agent: XiaobaiAgent;
  private port: number;
  private pendingPermissions = new Map<string, PendingPermission>();
  private activeTasks = new Map<string, AbortController>();

  constructor(options: ACPAdapterOptions) {
    this.agent = options.agent;
    this.port = options.port ?? 4121;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, () => resolve());
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    for (const [, controller] of this.activeTasks) {
      controller.abort();
    }
    this.activeTasks.clear();
    if (!this.server) return;
    return new Promise((resolve) => this.server!.close(() => resolve()));
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }).end();
      return;
    }

    if (req.method !== 'POST') {
      this.sendError(res, -32600, 'Only POST supported', 400);
      return;
    }

    const body = await this.readBody(req);
    const request = body as ACPRequest;

    if (request.jsonrpc !== '2.0') {
      this.sendError(res, -32600, 'Invalid JSON-RPC version');
      return;
    }

    try {
      const result = await this.route(request);
      this.sendResult(res, request.id, result);
    } catch (err) {
      this.sendError(res, -32603, (err as Error).message);
    }
  }

  private async route(request: ACPRequest): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize();

      case 'task/start':
        return this.handleTaskStart(request.params as unknown as ACPTaskParams);

      case 'task/cancel':
        return this.handleTaskCancel(request.params as { taskId: string });

      case 'permission/response':
        return this.handlePermissionResponse(request.params as { id: string; allowed: boolean });

      case 'shutdown':
        this.stop();
        return null;

      default:
        throw new Error(`Unknown method: ${request.method}`);
    }
  }

  private handleInitialize(): ACPAgentInfo {
    const model = this.agent.getCurrentModel();
    return {
      name: 'xiaobai-agent',
      version: '0.2.0',
      capabilities: {
        streaming: true,
        tools: this.agent.getTools().getToolDefinitions().map((t) => t.name),
        models: [model.model],
      },
    };
  }

  private async handleTaskStart(params: ACPTaskParams): Promise<ACPTaskResult> {
    const taskId = randomUUID();
    const abortController = new AbortController();
    this.activeTasks.set(taskId, abortController);

    try {
      const result = await this.agent.chatSync(params.prompt);
      return { output: result, success: true };
    } catch (err) {
      return { output: '', success: false };
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  private handleTaskCancel(params: { taskId: string }): { cancelled: boolean } {
    const controller = this.activeTasks.get(params.taskId);
    if (controller) {
      controller.abort();
      this.activeTasks.delete(params.taskId);
      return { cancelled: true };
    }
    return { cancelled: false };
  }

  private handlePermissionResponse(params: { id: string; allowed: boolean }): { ok: boolean } {
    const pending = this.pendingPermissions.get(params.id);
    if (pending) {
      pending.resolve(params.allowed);
      this.pendingPermissions.delete(params.id);
    }
    return { ok: true };
  }

  private sendResult(res: ServerResponse, id: string | number, result: unknown): void {
    const response: ACPResponse = { jsonrpc: '2.0', id, result };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(response));
  }

  private sendError(res: ServerResponse, code: number, message: string, httpStatus = 200): void {
    const response: ACPResponse = { jsonrpc: '2.0', id: 0, error: { code, message } };
    res.writeHead(httpStatus, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(response));
  }

  private readBody(req: IncomingMessage): Promise<unknown> {
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
