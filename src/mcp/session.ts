import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ToolDefinition, Tool, ToolResult } from '../tools/registry.js';

interface MCPServerConfig {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class MCPSession {
  private configDir: string;
  private servers = new Map<string, MCPServerConfig>();
  private connections = new Map<string, MCPConnection>();

  constructor(configDir: string) {
    this.configDir = join(configDir, 'mcp');
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    this.loadConfig();
  }

  private loadConfig(): void {
    const configPath = join(this.configDir, 'servers.json');
    if (!existsSync(configPath)) return;
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const servers = JSON.parse(raw) as MCPServerConfig[];
      for (const server of servers) {
        this.servers.set(server.name, server);
      }
    } catch {
      // Invalid config, skip
    }
  }

  addServer(config: MCPServerConfig): void {
    this.servers.set(config.name, config);
    this.saveConfig();
  }

  removeServer(name: string): boolean {
    if (!this.servers.has(name)) return false;
    this.servers.delete(name);
    this.saveConfig();
    return true;
  }

  getServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  getEnabledServers(): MCPServerConfig[] {
    return Array.from(this.servers.values()).filter((s) => s.enabled);
  }

  async connect(name: string): Promise<MCPConnection | null> {
    const config = this.servers.get(name);
    if (!config || !config.enabled) return null;

    const existing = this.connections.get(name);
    if (existing?.isAlive()) return existing;

    const connection = new MCPConnection(config);
    const started = await connection.start();
    if (!started) return null;

    this.connections.set(name, connection);
    return connection;
  }

  async connectAll(): Promise<Map<string, MCPConnection>> {
    const enabled = this.getEnabledServers();
    const results = new Map<string, MCPConnection>();

    for (const server of enabled) {
      const conn = await this.connect(server.name);
      if (conn) results.set(server.name, conn);
    }

    return results;
  }

  async discoverTools(): Promise<Map<string, ToolDefinition[]>> {
    const toolMap = new Map<string, ToolDefinition[]>();
    const connections = await this.connectAll();

    for (const [name, conn] of connections) {
      const tools = await conn.listTools();
      toolMap.set(name, tools);
    }

    return toolMap;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const conn = this.connections.get(serverName);
    if (!conn || !conn.isAlive()) {
      return { output: `MCP server '${serverName}' not connected`, success: false, error: 'not_connected' };
    }

    try {
      const result = await conn.callTool(toolName, args);
      return {
        output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        success: true,
      };
    } catch (error) {
      return {
        output: `MCP tool call failed: ${(error as Error).message}`,
        success: false,
        error: 'tool_call_failed',
      };
    }
  }

  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (conn) {
      conn.stop();
      this.connections.delete(name);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      conn.stop();
    }
    this.connections.clear();
  }

  getConnection(name: string): MCPConnection | undefined {
    return this.connections.get(name);
  }

  private saveConfig(): void {
    const configPath = join(this.configDir, 'servers.json');
    writeFileSync(
      configPath,
      JSON.stringify(Array.from(this.servers.values()), null, 2),
      'utf-8',
    );
  }
}

export class MCPConnection {
  private config: MCPServerConfig;
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private buffer = '';
  private alive = false;
  private capabilities: Record<string, unknown> = {};

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  async start(): Promise<boolean> {
    if (!this.config.command) return false;

    try {
      this.process = spawn(this.config.command, this.config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        windowsHide: true,
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString('utf-8'));
      });

      this.process.on('error', () => {
        this.alive = false;
      });

      this.process.on('close', () => {
        this.alive = false;
        for (const [, pending] of this.pending) {
          pending.reject(new Error('Connection closed'));
        }
        this.pending.clear();
      });

      this.alive = true;

      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'xiaobai', version: '0.1.0' },
      });

      this.capabilities = (initResult as Record<string, unknown>)?.capabilities as Record<string, unknown> ?? {};

      await this.sendNotification('notifications/initialized', {});
      return true;
    } catch {
      this.alive = false;
      return false;
    }
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.alive = false;
  }

  isAlive(): boolean {
    return this.alive && this.process !== null;
  }

  async listTools(): Promise<ToolDefinition[]> {
    try {
      const result = await this.sendRequest('tools/list', {}) as { tools?: MCPToolDef[] };
      return (result.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? '',
        parameters: {
          type: 'object' as const,
          properties: (t.inputSchema?.properties ?? {}) as Record<string, import('../tools/registry.js').ToolParameter>,
          required: (t.inputSchema?.required as string[]) ?? [],
        },
      }));
    } catch {
      return [];
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

      this.pending.set(id, { resolve, reject });

      const message = `Content-Length: ${Buffer.byteLength(JSON.stringify(request))}\r\n\r\n${JSON.stringify(request)}`;
      this.process?.stdin?.write(message);

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    const notification = { jsonrpc: '2.0', method, params };
    const message = `Content-Length: ${Buffer.byteLength(JSON.stringify(notification))}\r\n\r\n${JSON.stringify(notification)}`;
    this.process?.stdin?.write(message);
  }

  private handleData(data: string): void {
    this.buffer += data;

    while (this.buffer.length > 0) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;

      const contentLength = parseInt(match[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) break;

      const messageStr = this.buffer.slice(messageStart, messageEnd);
      this.buffer = this.buffer.slice(messageEnd);

      try {
        const response = JSON.parse(messageStr) as JsonRpcResponse;
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        // Invalid JSON, skip
      }
    }
  }
}

export function createMCPTools(serverName: string, toolDefs: ToolDefinition[], session: MCPSession): Tool[] {
  return toolDefs.map(
    (def): Tool => ({
      definition: def,
      async execute(args: Record<string, unknown>): Promise<ToolResult> {
        return session.callTool(serverName, def.name, args);
      },
    }),
  );
}
