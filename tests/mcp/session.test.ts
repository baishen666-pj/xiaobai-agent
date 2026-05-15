import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MCPSession, createMCPTools } from '../../src/mcp/session.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ToolDefinition } from '../../src/tools/registry.js';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `xiaobai-mcp-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('MCPSession Config', () => {
  it('adds and lists servers', () => {
    const session = new MCPSession(testDir);
    session.addServer({ name: 'test-server', command: 'echo', enabled: true });
    const servers = session.getServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('test-server');
  });

  it('removes servers', () => {
    const session = new MCPSession(testDir);
    session.addServer({ name: 'remove-me', command: 'echo', enabled: true });
    expect(session.removeServer('remove-me')).toBe(true);
    expect(session.getServers()).toHaveLength(0);
  });

  it('persists config to disk', () => {
    const session = new MCPSession(testDir);
    session.addServer({ name: 'persist-test', command: 'node', args: ['server.js'], enabled: true });

    const session2 = new MCPSession(testDir);
    const servers = session2.getServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('persist-test');
  });

  it('filters enabled servers', () => {
    const session = new MCPSession(testDir);
    session.addServer({ name: 'enabled', command: 'echo', enabled: true });
    session.addServer({ name: 'disabled', command: 'echo', enabled: false });
    const enabled = session.getEnabledServers();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe('enabled');
  });

  it('handles missing config gracefully', () => {
    const session = new MCPSession(testDir);
    expect(session.getServers()).toEqual([]);
  });
});

describe('createMCPTools', () => {
  it('creates tool wrappers from definitions', () => {
    const session = new MCPSession(testDir);
    const defs: ToolDefinition[] = [
      {
        name: 'test-tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'test input' },
          },
          required: ['input'],
        },
      },
    ];

    const tools = createMCPTools('test-server', defs, session);
    expect(tools).toHaveLength(1);
    expect(tools[0].definition.name).toBe('test-tool');
    expect(tools[0].definition.description).toBe('A test tool');
  });

  it('tools return error when server not connected', async () => {
    const session = new MCPSession(testDir);
    const defs: ToolDefinition[] = [
      {
        name: 'disconnected-tool',
        description: 'No server',
        parameters: { type: 'object', properties: {} },
      },
    ];

    const tools = createMCPTools('nonexistent', defs, session);
    const result = await tools[0].execute({});
    expect(result.success).toBe(false);
    expect(result.error).toBe('not_connected');
  });
});

describe('MCP Session Lifecycle', () => {
  it('returns null for unknown server connection', async () => {
    const session = new MCPSession(testDir);
    const conn = await session.connect('unknown');
    expect(conn).toBeNull();
  });

  it('returns null for disabled server', async () => {
    const session = new MCPSession(testDir);
    session.addServer({ name: 'disabled', command: 'nonexistent', enabled: false });
    const conn = await session.connect('disabled');
    expect(conn).toBeNull();
  });

  it('discovers tools from all connected servers', async () => {
    const session = new MCPSession(testDir);
    const toolMap = await session.discoverTools();
    expect(toolMap.size).toBe(0);
  });

  it('disconnectAll clears connections', async () => {
    const session = new MCPSession(testDir);
    await session.disconnectAll();
    expect(session.getConnection('any')).toBeUndefined();
  });
});
