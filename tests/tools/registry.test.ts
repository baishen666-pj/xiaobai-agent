import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool, ToolResult, ToolContext } from '../../src/tools/registry.js';

// Helper: create a minimal mock tool with given name
function makeTool(name: string, execOverride?: (args: Record<string, unknown>, context?: ToolContext) => Promise<ToolResult>): Tool {
  return {
    definition: {
      name,
      description: `Mock tool: ${name}`,
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'input value' },
        },
      },
    },
    execute:
      execOverride ??
      (async (args) => ({
        output: `executed ${name} with ${JSON.stringify(args)}`,
        success: true,
      })),
  };
}

// Helper: create a tool that throws an Error
function makeThrowingTool(name: string, errorMessage: string): Tool {
  return {
    definition: {
      name,
      description: `Throwing tool: ${name}`,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: async () => {
      throw new Error(errorMessage);
    },
  };
}

// Helper: create a tool that throws a non-Error value
function makeNonErrorThrowingTool(name: string, thrownValue: unknown): Tool {
  return {
    definition: {
      name,
      description: `Non-error throwing tool: ${name}`,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: async () => {
      throw thrownValue;
    },
  };
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe('ToolRegistry.register', () => {
  it('registers a tool so it appears in list', () => {
    const registry = new ToolRegistry();
    const tool = makeTool('my_tool');
    registry.register(tool);
    expect(registry.list()).toContain('my_tool');
  });

  it('overwrites a tool with the same name', () => {
    const registry = new ToolRegistry();
    const toolV1 = makeTool('dup_tool', async () => ({ output: 'v1', success: true }));
    const toolV2 = makeTool('dup_tool', async () => ({ output: 'v2', success: true }));
    registry.register(toolV1);
    registry.register(toolV2);
    expect(registry.list()).toHaveLength(1);
    // Verify the second registration wins
    return expect(
      registry.execute('dup_tool', {}).then((r) => r.output),
    ).resolves.toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// registerBatch
// ---------------------------------------------------------------------------

describe('ToolRegistry.registerBatch', () => {
  it('registers multiple tools at once', () => {
    const registry = new ToolRegistry();
    const tools = [makeTool('a'), makeTool('b'), makeTool('c')];
    registry.registerBatch(tools);
    expect(registry.list()).toContain('a');
    expect(registry.list()).toContain('b');
    expect(registry.list()).toContain('c');
  });

  it('handles empty array without error', () => {
    const registry = new ToolRegistry();
    registry.registerBatch([]);
    expect(registry.list()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// registerMcpTool
// ---------------------------------------------------------------------------

describe('ToolRegistry.registerMcpTool', () => {
  it('registers tool with mcp_ prefixed name', () => {
    const registry = new ToolRegistry();
    const tool = makeTool('search');
    registry.registerMcpTool('myserver', tool);
    expect(registry.list()).toContain('mcp_myserver_search');
    expect(registry.list()).not.toContain('search');
  });

  it('overrides the tool definition name with the prefixed name', () => {
    const registry = new ToolRegistry();
    const tool = makeTool('query');
    registry.registerMcpTool('remote', tool);
    const defs = registry.getToolDefinitions();
    const mcpDef = defs.find((d) => d.name === 'mcp_remote_query');
    expect(mcpDef).toBeDefined();
    expect(mcpDef!.name).toBe('mcp_remote_query');
  });

  it('preserves other definition properties', () => {
    const registry = new ToolRegistry();
    const tool = makeTool('analyze');
    registry.registerMcpTool('svc', tool);
    const defs = registry.getToolDefinitions();
    const mcpDef = defs.find((d) => d.name === 'mcp_svc_analyze');
    expect(mcpDef!.description).toBe('Mock tool: analyze');
    expect(mcpDef!.parameters.type).toBe('object');
  });

  it('allows executing via prefixed name', async () => {
    const registry = new ToolRegistry();
    const tool = makeTool('ping', async () => ({
      output: 'pong',
      success: true,
    }));
    registry.registerMcpTool('net', tool);
    const result = await registry.execute('mcp_net_ping', {});
    expect(result.success).toBe(true);
    expect(result.output).toBe('pong');
  });

  it('does not register tool under original name', async () => {
    const registry = new ToolRegistry();
    const tool = makeTool('compute');
    registry.registerMcpTool('cluster', tool);
    expect(registry.has('compute')).toBe(false);
  });

  it('isolates MCP tools from regular tools namespace', () => {
    const registry = new ToolRegistry();
    const regularTool = makeTool('status');
    const mcpTool = makeTool('status');
    registry.register(regularTool);
    registry.registerMcpTool('ext', mcpTool);
    // Both should exist under different names
    expect(registry.has('status')).toBe(true);
    expect(registry.has('mcp_ext_status')).toBe(true);
    expect(registry.list()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------

describe('ToolRegistry.execute', () => {
  it('returns success result from a registered tool', async () => {
    const registry = new ToolRegistry();
    const tool = makeTool('adder', async (args) => ({
      output: `${Number(args.a) + Number(args.b)}`,
      success: true,
    }));
    registry.register(tool);
    const result = await registry.execute('adder', { a: 2, b: 3 });
    expect(result.success).toBe(true);
    expect(result.output).toBe('5');
  });

  it('passes context to the tool execute function', async () => {
    const registry = new ToolRegistry();
    let receivedContext: ToolContext | undefined;
    const tool: Tool = {
      definition: {
        name: 'ctx_tool',
        description: 'Context receiver',
        parameters: { type: 'object', properties: {} },
      },
      execute: async (_args, context) => {
        receivedContext = context;
        return { output: 'ok', success: true };
      },
    };
    registry.register(tool);
    const ctx = {} as ToolContext;
    await registry.execute('ctx_tool', {}, ctx);
    expect(receivedContext).toBe(ctx);
  });

  it('returns tool_not_found when tool does not exist', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('nonexistent', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('tool_not_found');
    expect(result.output).toContain('Unknown tool: nonexistent');
  });

  it('catches Error thrown by tool and returns execution_error', async () => {
    const registry = new ToolRegistry();
    const tool = makeThrowingTool('fail_tool', 'something went wrong');
    registry.register(tool);
    const result = await registry.execute('fail_tool', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('execution_error');
    expect(result.output).toContain('something went wrong');
    expect(result.output).toContain('Tool execution failed');
  });

  it('catches non-Error thrown value and returns execution_error', async () => {
    const registry = new ToolRegistry();
    const tool = makeNonErrorThrowingTool('str_fail', 'string error message');
    registry.register(tool);
    const result = await registry.execute('str_fail', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('execution_error');
    expect(result.output).toContain('string error message');
  });

  it('catches null thrown value and returns execution_error', async () => {
    const registry = new ToolRegistry();
    const tool = makeNonErrorThrowingTool('null_fail', null);
    registry.register(tool);
    const result = await registry.execute('null_fail', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('execution_error');
    expect(result.output).toContain('null');
  });

  it('catches number thrown value and returns execution_error', async () => {
    const registry = new ToolRegistry();
    const tool = makeNonErrorThrowingTool('num_fail', 42);
    registry.register(tool);
    const result = await registry.execute('num_fail', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('execution_error');
    expect(result.output).toContain('42');
  });

  it('falls back to MCP tools when regular tool not found', async () => {
    const registry = new ToolRegistry();
    const tool = makeTool('lookup', async () => ({
      output: 'mcp-lookup-result',
      success: true,
    }));
    registry.registerMcpTool('remote', tool);
    const result = await registry.execute('mcp_remote_lookup', {});
    expect(result.success).toBe(true);
    expect(result.output).toBe('mcp-lookup-result');
  });

  it('prefers regular tool over MCP tool with same prefixed name', async () => {
    const registry = new ToolRegistry();
    // Register a regular tool with the mcp-prefixed naming convention
    const regularTool = makeTool('mcp_srv_action', async () => ({
      output: 'regular',
      success: true,
    }));
    registry.register(regularTool);
    // Register an MCP tool that would also produce mcp_srv_action
    const mcpTool = makeTool('action', async () => ({
      output: 'mcp',
      success: true,
    }));
    registry.registerMcpTool('srv', mcpTool);
    // Regular tools are checked first (tools.get ?? mcpTools.get)
    const result = await registry.execute('mcp_srv_action', {});
    expect(result.output).toBe('regular');
  });
});

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('ToolRegistry.getToolDefinitions', () => {
  it('returns empty array when no tools registered', () => {
    const registry = new ToolRegistry();
    expect(registry.getToolDefinitions()).toEqual([]);
  });

  it('returns definitions for regular tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('alpha'));
    registry.register(makeTool('beta'));
    const defs = registry.getToolDefinitions();
    expect(defs).toHaveLength(2);
    const names = defs.map((d) => d.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('returns definitions for both regular and MCP tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('local_tool'));
    registry.registerMcpTool('ext', makeTool('remote_tool'));
    const defs = registry.getToolDefinitions();
    expect(defs).toHaveLength(2);
    const names = defs.map((d) => d.name);
    expect(names).toContain('local_tool');
    expect(names).toContain('mcp_ext_remote_tool');
  });

  it('returns only definitions (not the execute function)', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('only_def'));
    const defs = registry.getToolDefinitions();
    for (const d of defs) {
      expect(d).toHaveProperty('name');
      expect(d).toHaveProperty('description');
      expect(d).toHaveProperty('parameters');
      // Should not have execute (it's a ToolDefinition, not a Tool)
      expect((d as any).execute).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// has
// ---------------------------------------------------------------------------

describe('ToolRegistry.has', () => {
  it('returns false when no tools registered', () => {
    const registry = new ToolRegistry();
    expect(registry.has('anything')).toBe(false);
  });

  it('returns true for a registered regular tool', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('exists'));
    expect(registry.has('exists')).toBe(true);
  });

  it('returns false for a tool that was never registered', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('real_tool'));
    expect(registry.has('fake_tool')).toBe(false);
  });

  it('returns true for a registered MCP tool', () => {
    const registry = new ToolRegistry();
    registry.registerMcpTool('server', makeTool('mcp_func'));
    expect(registry.has('mcp_server_mcp_func')).toBe(true);
  });

  it('returns false for the original name of an MCP tool', () => {
    const registry = new ToolRegistry();
    registry.registerMcpTool('server', makeTool('mcp_func'));
    expect(registry.has('mcp_func')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('ToolRegistry.list', () => {
  it('returns empty array when no tools registered', () => {
    const registry = new ToolRegistry();
    expect(registry.list()).toEqual([]);
  });

  it('lists regular tool names', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('x'));
    registry.register(makeTool('y'));
    expect(registry.list()).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('lists MCP tool names with prefix', () => {
    const registry = new ToolRegistry();
    registry.registerMcpTool('svc', makeTool('action'));
    expect(registry.list()).toEqual(['mcp_svc_action']);
  });

  it('lists both regular and MCP tools together', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('local'));
    registry.registerMcpTool('ext', makeTool('remote'));
    const names = registry.list();
    expect(names).toContain('local');
    expect(names).toContain('mcp_ext_remote');
    expect(names).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// unregister
// ---------------------------------------------------------------------------

describe('ToolRegistry.unregister', () => {
  it('removes a registered regular tool and returns true', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('to_remove'));
    expect(registry.has('to_remove')).toBe(true);
    const result = registry.unregister('to_remove');
    expect(result).toBe(true);
    expect(registry.has('to_remove')).toBe(false);
  });

  it('returns false when unregistering a non-existent tool', () => {
    const registry = new ToolRegistry();
    const result = registry.unregister('ghost');
    expect(result).toBe(false);
  });

  it('removes an MCP tool and returns true', () => {
    const registry = new ToolRegistry();
    registry.registerMcpTool('srv', makeTool('func'));
    const prefixedName = 'mcp_srv_func';
    expect(registry.has(prefixedName)).toBe(true);
    const result = registry.unregister(prefixedName);
    expect(result).toBe(true);
    expect(registry.has(prefixedName)).toBe(false);
  });

  it('does not affect other tools when one is unregistered', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('keep'));
    registry.register(makeTool('remove'));
    registry.unregister('remove');
    expect(registry.has('keep')).toBe(true);
    expect(registry.has('remove')).toBe(false);
  });

  it('unregistered tool no longer appears in list or definitions', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('temp'));
    registry.unregister('temp');
    expect(registry.list()).not.toContain('temp');
    expect(registry.getToolDefinitions()).toHaveLength(0);
  });
});
