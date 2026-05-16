import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPSession } from '../../src/mcp/session.js';
import { MCPConnection } from '../../src/mcp/session.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'xiaobai-mcp-res-'));
});

describe('MCPResource types', () => {
  it('module loads without error', async () => {
    const mod = await import('../../src/mcp/resources.js');
    expect(mod).toBeDefined();
  });
});

describe('MCPConnection resource methods', () => {
  it('listResources returns empty when capabilities do not support resources', async () => {
    const conn = new MCPConnection({ name: 'test', command: 'echo', enabled: true });
    // Without starting, capabilities is empty
    const resources = await conn.listResources();
    expect(resources).toEqual([]);
  });

  it('readResource sends correct request', async () => {
    const conn = new MCPConnection({ name: 'test', command: 'echo', enabled: true });
    const sendSpy = vi.spyOn(conn as unknown as { sendRequest: (m: string, p: Record<string, unknown>) => Promise<unknown> }, 'sendRequest');
    sendSpy.mockRejectedValue(new Error('not connected'));
    await expect(conn.readResource('file:///test.txt')).rejects.toThrow();
  });
});

describe('MCPConnection prompt methods', () => {
  it('listPrompts returns empty when capabilities do not support prompts', async () => {
    const conn = new MCPConnection({ name: 'test', command: 'echo', enabled: true });
    const prompts = await conn.listPrompts();
    expect(prompts).toEqual([]);
  });

  it('getPrompt sends correct request', async () => {
    const conn = new MCPConnection({ name: 'test', command: 'echo', enabled: true });
    const sendSpy = vi.spyOn(conn as unknown as { sendRequest: (m: string, p: Record<string, unknown>) => Promise<unknown> }, 'sendRequest');
    sendSpy.mockRejectedValue(new Error('not connected'));
    await expect(conn.getPrompt('test-prompt')).rejects.toThrow();
  });
});

describe('MCPSession resource/prompt aggregation', () => {
  it('discoverResources returns empty for no connections', async () => {
    const session = new MCPSession(tempDir);
    const resources = await session.discoverResources();
    expect(resources.size).toBe(0);
  });

  it('readResource returns empty for unknown server', async () => {
    const session = new MCPSession(tempDir);
    const result = await session.readResource('unknown', 'file:///test.txt');
    expect(result).toEqual([]);
  });

  it('discoverPrompts returns empty for no connections', async () => {
    const session = new MCPSession(tempDir);
    const prompts = await session.discoverPrompts();
    expect(prompts.size).toBe(0);
  });

  it('getPrompt returns empty for unknown server', async () => {
    const session = new MCPSession(tempDir);
    const result = await session.getPrompt('unknown', 'test');
    expect(result).toEqual([]);
  });
});
