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

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  registerBatch(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  registerMcpTool(serverName: string, tool: Tool): void {
    const prefixedName = `mcp_${serverName}_${tool.definition.name}`;
    this.mcpTools.set(prefixedName, {
      ...tool,
      definition: { ...tool.definition, name: prefixedName },
    });
  }

  async execute(name: string, args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name) ?? this.mcpTools.get(name);
    if (!tool) {
      return { output: `Unknown tool: ${name}`, success: false, error: 'tool_not_found' };
    }
    try {
      return await tool.execute(args, context);
    } catch (error) {
      return {
        output: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
        error: 'execution_error',
      };
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      ...Array.from(this.tools.values()),
      ...Array.from(this.mcpTools.values()),
    ].map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name) || this.mcpTools.has(name);
  }

  list(): string[] {
    return [...this.tools.keys(), ...this.mcpTools.keys()];
  }

  unregister(name: string): boolean {
    return this.tools.delete(name) || this.mcpTools.delete(name);
  }
}
