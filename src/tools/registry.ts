export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
  properties?: Record<string, ToolParameter>;
}

export interface ToolResult {
  output: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolContext {
  security: import('../security/manager.js').SecurityManager;
  config: import('../config/manager.js').ConfigManager;
  memory?: import('../memory/system.js').MemorySystem;
  sandbox?: import('../sandbox/manager.js').SandboxManager;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private mcpTools = new Map<string, Tool>();
  private definitionsCache: ToolDefinition[] | null = null;
  private tracer?: import('../telemetry/tracer.js').Tracer;

  setTracer(tracer: import('../telemetry/tracer.js').Tracer): void {
    this.tracer = tracer;
  }

  private invalidateCache(): void {
    this.definitionsCache = null;
  }

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
    this.invalidateCache();
  }

  registerBatch(tools: Tool[]): void {
    for (const tool of tools) {
      this.tools.set(tool.definition.name, tool);
    }
    this.invalidateCache();
  }

  registerMcpTool(serverName: string, tool: Tool): void {
    const prefixedName = `mcp_${serverName}_${tool.definition.name}`;
    this.mcpTools.set(prefixedName, {
      ...tool,
      definition: { ...tool.definition, name: prefixedName },
    });
    this.invalidateCache();
  }

  async execute(name: string, args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name) ?? this.mcpTools.get(name);
    if (!tool) {
      return { output: `Unknown tool: ${name}`, success: false, error: 'tool_not_found' };
    }

    const span = this.tracer?.startSpan(`tool.${name}`, {
      attributes: { tool: name },
    });

    try {
      const result = await tool.execute(args, context);
      span?.setAttribute('success', result.success);
      span?.setStatus(result.success ? 'ok' : 'error');
      return result;
    } catch (error) {
      span?.setStatus('error');
      return {
        output: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
        error: 'execution_error',
      };
    } finally {
      span?.end();
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    if (this.definitionsCache) return this.definitionsCache;
    this.definitionsCache = [
      ...Array.from(this.tools.values()),
      ...Array.from(this.mcpTools.values()),
    ].map((t) => t.definition);
    return this.definitionsCache;
  }

  has(name: string): boolean {
    return this.tools.has(name) || this.mcpTools.has(name);
  }

  list(): string[] {
    return [...this.tools.keys(), ...this.mcpTools.keys()];
  }

  unregister(name: string): boolean {
    const removed = this.tools.delete(name) || this.mcpTools.delete(name);
    if (removed) this.invalidateCache();
    return removed;
  }
}
