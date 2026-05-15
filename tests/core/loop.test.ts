import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';

describe('ToolRegistry', () => {
  it('should register and execute a tool', async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'test_tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Test input' },
          },
          required: ['input'],
        },
      },
      async execute(args) {
        return { output: `Echo: ${args['input']}`, success: true };
      },
    });

    expect(registry.has('test_tool')).toBe(true);
    const result = await registry.execute('test_tool', { input: 'hello' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('Echo: hello');
  });

  it('should return error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('nonexistent', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('tool_not_found');
  });

  it('should list registered tools', () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'tool_a',
        description: 'Tool A',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        return { output: '', success: true };
      },
    });
    registry.register({
      definition: {
        name: 'tool_b',
        description: 'Tool B',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        return { output: '', success: true };
      },
    });

    expect(registry.list()).toEqual(['tool_a', 'tool_b']);
  });

  it('should unregister a tool', () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: {
        name: 'removable',
        description: 'Can be removed',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        return { output: '', success: true };
      },
    });

    expect(registry.has('removable')).toBe(true);
    expect(registry.unregister('removable')).toBe(true);
    expect(registry.has('removable')).toBe(false);
  });

  it('should register MCP tools with prefix', () => {
    const registry = new ToolRegistry();
    registry.registerMcpTool('myserver', {
      definition: {
        name: 'search',
        description: 'Search tool',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        return { output: '', success: true };
      },
    });

    expect(registry.has('mcp_myserver_search')).toBe(true);
    expect(registry.has('search')).toBe(false);
  });
});
