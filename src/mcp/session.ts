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

const MAX_PENDING_REQUESTS = 1000;

// Read version from package.json at module load time
const PKG_VERSION = (() => {
  try {
    const pkgUrl = new URL('../../package.json', import.meta.url);
    const raw = readFileSync(pkgUrl, 'utf-8');
    return (JSON.parse(raw) as { version: string }).version;
  } catch (e) {
    console.debug('mcp: cannot read package.json for version', (e as Error).message);
    return '0.5.0';
  }
})();

export class MCPSession {
  private configDir: string;
  private servers = new Map<string, MCPServerConfig>();
  private connections = new Map<string, MCPConnection>();
  private exitHandler: (() => void) | null = null;

  constructor(configDir: string) {
    this.configDir = join(configDir, 'mcp');
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    this.loadConfig();

    // Ensure MCP child processes are cleaned up on process exit
    this.exitHandler = () => { this.disconnectAllSync(); };
    process.on('exit', this.exitHandler);
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
    } catch (e) {
      console.debug('mcp: invalid config file, skipping', (e as Error).message);
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

  async connectSSE(name: string): Promise<MCPConnection | null> {
    const config = this.servers.get(name);
    if (!config || !config.enabled || !config.url) return null;

    const existing = this.connections.get(name);
    if (existing?.isAlive()) return existing;

    const connection = new MCPSSEConnection(config);
    const started = await connection.start();
    if (!started) return null;

    this.connections.set(name, connection);
    return connection;
  }

  async connectAll(): Promise<Map<string, MCPConnection>> {
    const enabled = this.getEnabledServers();
    const results = new Map<string, MCPConnection>();

    const settled = await Promise.allSettled(
      enabled.map(async (server) => {
        const conn = await this.connect(server.name);
        return { name: server.name, conn };
      }),
    );

    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value.conn) {
        results.set(result.value.name, result.value.conn);
      }
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

  async discoverResources(): Promise<Map<string, import('./resources.js').MCPResource[]>> {
    const resourceMap = new Map<string, import('./resources.js').MCPResource[]>();
    for (const [name, conn] of this.connections) {
      if (!conn.isAlive()) continue;
      const resources = await conn.listResources();
      if (resources.length > 0) resourceMap.set(name, resources);
    }
    return resourceMap;
  }

  async readResource(serverName: string, uri: string): Promise<import('./resources.js').MCPResourceContent[]> {
    const conn = this.connections.get(serverName);
    if (!conn?.isAlive()) return [];
    return conn.readResource(uri);
  }

  async discoverPrompts(): Promise<Map<string, import('./prompts.js').MCPPrompt[]>> {
    const promptMap = new Map<string, import('./prompts.js').MCPPrompt[]>();
    for (const [name, conn] of this.connections) {
      if (!conn.isAlive()) continue;
      const prompts = await conn.listPrompts();
      if (prompts.length > 0) promptMap.set(name, prompts);
    }
    return promptMap;
  }

  async getPrompt(serverName: string, name: string, args?: Record<string, string>): Promise<import('./prompts.js').MCPPromptMessage[]> {
    const conn = this.connections.get(serverName);
    if (!conn?.isAlive()) return [];
    return conn.getPrompt(name, args);
  }

  // ── Deferred tool loading (from Claude Code pattern) ──
  // Only load tool names initially; full schemas fetched on demand.

  private toolNameCache = new Map<string, string[]>();
  private fullToolCache = new Map<string, ToolDefinition[]>();

  async discoverToolNames(): Promise<Map<string, string[]>> {
    const nameMap = new Map<string, string[]>();
    const connections = await this.connectAll();

    for (const [serverName, conn] of connections) {
      if (this.toolNameCache.has(serverName)) {
        nameMap.set(serverName, this.toolNameCache.get(serverName)!);
        continue;
      }

      const tools = await conn.listTools();
      const names = tools.map((t) => t.name);
      this.toolNameCache.set(serverName, names);
      nameMap.set(serverName, names);
    }

    return nameMap;
  }

  async getFullToolDefinition(serverName: string, toolName: string): Promise<ToolDefinition | null> {
    const cached = this.fullToolCache.get(serverName);
    if (cached) {
      return cached.find((t) => t.name === toolName) ?? null;
    }

    const conn = this.connections.get(serverName);
    if (!conn) return null;

    const tools = await conn.listTools();
    this.fullToolCache.set(serverName, tools);
    return tools.find((t) => t.name === toolName) ?? null;
  }

  clearToolCache(serverName?: string): void {
    if (serverName) {
      this.toolNameCache.delete(serverName);
      this.fullToolCache.delete(serverName);
    } else {
      this.toolNameCache.clear();
      this.fullToolCache.clear();
    }
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
    this.unregisterExitHandler();
  }

  /** Synchronous cleanup for process exit — cannot be async */
  private disconnectAllSync(): void {
    for (const [, conn] of this.connections) {
      conn.stop();
    }
    this.connections.clear();
  }

  private unregisterExitHandler(): void {
    if (this.exitHandler) {
      process.off('exit', this.exitHandler);
      this.exitHandler = null;
    }
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
  protected config: MCPServerConfig;
  protected process: ChildProcess | null = null;
  protected requestId = 0;
  protected pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  protected buffer = '';
  protected alive = false;
  protected capabilities: Record<string, unknown> = {};

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  /** Build a minimal env with only essential PATH and system vars — never leaks API keys */
  protected buildSafeEnv(): Record<string, string> {
    const safe = new Set([
      'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'TEMP', 'TMP',
      'SHELL', 'TERM', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'COMSPEC',
      'NODE_OPTIONS', 'NODE_PATH',
    ]);
    const env: Record<string, string> = {};
    for (const key of Object.keys(process.env)) {
      if (safe.has(key.toUpperCase()) || safe.has(key)) {
        const val = process.env[key];
        if (val !== undefined) env[key] = val;
      }
    }
    return env;
  }

  async start(): Promise<boolean> {
    if (!this.config.command) return false;

    try {
      this.process = spawn(this.config.command, this.config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.buildSafeEnv(),
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
          clearTimeout(pending.timer);
          pending.reject(new Error('Connection closed'));
        }
        this.pending.clear();
      });

      this.alive = true;

      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'xiaobai', version: PKG_VERSION },
      });

      this.capabilities = (initResult as Record<string, unknown>)?.capabilities as Record<string, unknown> ?? {};

      await this.sendNotification('notifications/initialized', {});
      return true;
    } catch (e) {
      console.debug('mcp: connection start failed', (e as Error).message);
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
    } catch (e) {
      console.debug('mcp: listTools failed', (e as Error).message);
      return [];
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  async listResources(): Promise<import('./resources.js').MCPResource[]> {
    try {
      const caps = this.capabilities as Record<string, unknown>;
      if (!caps?.resources) return [];
      const result = await this.sendRequest('resources/list', {}) as { resources?: import('./resources.js').MCPResource[] };
      return result.resources ?? [];
    } catch (e) {
      console.debug('mcp: listResources failed', (e as Error).message);
      return [];
    }
  }

  async readResource(uri: string): Promise<import('./resources.js').MCPResourceContent[]> {
    const result = await this.sendRequest('resources/read', { uri }) as { contents?: import('./resources.js').MCPResourceContent[] };
    return result.contents ?? [];
  }

  async listPrompts(): Promise<import('./prompts.js').MCPPrompt[]> {
    try {
      const caps = this.capabilities as Record<string, unknown>;
      if (!caps?.prompts) return [];
      const result = await this.sendRequest('prompts/list', {}) as { prompts?: import('./prompts.js').MCPPrompt[] };
      return result.prompts ?? [];
    } catch (e) {
      console.debug('mcp: listPrompts failed', (e as Error).message);
      return [];
    }
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<import('./prompts.js').MCPPromptMessage[]> {
    const result = await this.sendRequest('prompts/get', { name, arguments: args ?? {} }) as { messages?: import('./prompts.js').MCPPromptMessage[] };
    return result.messages ?? [];
  }

  protected sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      if (this.pending.size >= MAX_PENDING_REQUESTS) {
        reject(new Error(`Too many pending requests (${this.pending.size})`));
        return;
      }

      const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);

      this.pending.set(id, { resolve, reject, timer });

      const message = `Content-Length: ${Buffer.byteLength(JSON.stringify(request))}\r\n\r\n${JSON.stringify(request)}`;
      this.process?.stdin?.write(message);
    });
  }

  protected async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    const notification = { jsonrpc: '2.0', method, params };
    const message = `Content-Length: ${Buffer.byteLength(JSON.stringify(notification))}\r\n\r\n${JSON.stringify(notification)}`;
    this.process?.stdin?.write(message);
  }

  protected handleData(data: string): void {
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
          clearTimeout(pending.timer);
          this.pending.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (e) {
        console.debug('mcp: invalid JSON in message handler', (e as Error).message);
      }
    }
  }
}

class MCPSSEConnection extends MCPConnection {
  private sseUrl: string;
  private messageEndpoint: string | null = null;
  private abortController: AbortController | null = null;
  private aliveFlag = false;
  private endpointReady: (() => void) | null = null;
  private endpointPromise = new Promise<void>((resolve) => { this.endpointReady = resolve; });

  constructor(config: MCPServerConfig) {
    super(config);
    this.sseUrl = config.url!;
  }

  override async start(): Promise<boolean> {
    try {
      this.abortController = new AbortController();
      this.aliveFlag = true;

      const response = await fetch(this.sseUrl, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal: this.abortController.signal,
      });

      if (!response.ok || !response.body) {
        this.aliveFlag = false;
        return false;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      const processStream = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (!data) continue;

                if (currentEvent === 'endpoint') {
                  this.messageEndpoint = data;
                  this.endpointReady?.();
                } else {
                  try {
                    const jsonRpcResponse = JSON.parse(data) as JsonRpcResponse;
                    this.handleSSEMessage(jsonRpcResponse);
                  } catch (e) {
                    console.debug('mcp-sse: non-JSON data line in SSE stream', (e as Error).message);
                  }
                }
                currentEvent = '';
              } else if (line.trim() === '') {
                currentEvent = '';
              }
            }
          }
        } catch (e) {
          console.debug('mcp-sse: stream ended or aborted', (e as Error).message);
        } finally {
          this.aliveFlag = false;
        }
      };

      processStream().catch(() => { /* stream error handled inside */ });

      await this.sendSSEInit();

      return true;
    } catch (e) {
      console.debug('mcp-sse: SSE connection start failed', (e as Error).message);
      this.aliveFlag = false;
      return false;
    }
  }

  override stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.aliveFlag = false;
  }

  override isAlive(): boolean {
    return this.aliveFlag;
  }

  protected override sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      if (this.pending.size >= MAX_PENDING_REQUESTS) {
        reject(new Error(`Too many pending requests (${this.pending.size})`));
        return;
      }

      const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);

      this.pending.set(id, { resolve, reject, timer });

      // Wait for endpoint, then POST
      this.endpointPromise.then(() => {
        if (!this.messageEndpoint) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error('No SSE message endpoint available'));
          return;
        }
        fetch(this.messageEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }).catch((err) => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        });
      });
    });
  }

  protected override async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    await this.endpointPromise;
    if (!this.messageEndpoint) return;

    const notification = { jsonrpc: '2.0', method, params };
    await fetch(this.messageEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    });
  }

  private handleSSEMessage(response: JsonRpcResponse): void {
    const handler = this.pending.get(response.id);
    if (handler) {
      clearTimeout(handler.timer);
      this.pending.delete(response.id);
      if (response.error) {
        handler.reject(new Error(response.error.message));
      } else {
        handler.resolve(response.result);
      }
    }
  }

  private async sendSSEInit(): Promise<void> {
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'xiaobai', version: PKG_VERSION },
    });
    this.capabilities = (initResult as Record<string, unknown>)?.capabilities as Record<string, unknown> ?? {};
    await this.sendNotification('notifications/initialized', {});
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
