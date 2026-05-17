import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginAPIImpl } from '../../src/plugins/api.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { HookSystem } from '../../src/hooks/system.js';
import { ConfigManager } from '../../src/config/manager.js';
import { MemorySystem } from '../../src/memory/system.js';
import { ProviderRouter } from '../../src/provider/router.js';
import { SandboxManager } from '../../src/sandbox/manager.js';
import type { PluginError, PluginManifest } from '../../src/plugins/types.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
let errors: PluginError[];
let tools: ToolRegistry;
let hooks: HookSystem;
let config: ConfigManager;
let memory: MemorySystem;
let provider: ProviderRouter;
let sandbox: SandboxManager;

function createApi(permissions: string[], manifestOverrides?: Partial<PluginManifest>) {
  const manifest: PluginManifest = {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'Test',
    permissions: permissions as PluginManifest['permissions'],
    ...manifestOverrides,
  };
  return new PluginAPIImpl(
    'test-plugin',
    manifest,
    tools,
    hooks,
    config,
    memory,
    provider,
    (err) => errors.push(err),
    sandbox,
  );
}

beforeEach(() => {
  tempDir = join(tmpdir(), `xiaobai-test-sandbox-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  errors = [];
  tools = new ToolRegistry();
  hooks = new HookSystem(tempDir);
  config = new ConfigManager();
  memory = new MemorySystem(tempDir);
  provider = new ProviderRouter(config.get());
  sandbox = new SandboxManager({ mode: 'workspace-write' });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Plugin Sandbox Integration', () => {
  it('allows tool registration without sandbox', () => {
    const api = createApi(['tools:register']);
    api.tools.register({
      definition: { name: 'safe-tool', description: 'Safe', parameters: { type: 'object', properties: {} } },
      execute: async () => ({ output: 'ok', success: true }),
    });
    expect(tools.has('test-plugin:safe-tool')).toBe(true);
  });

  it('enforces tools:execute permission', async () => {
    const api = createApi(['tools:register']);
    api.tools.register({
      definition: { name: 'my-tool', description: 'Test', parameters: { type: 'object', properties: {} } },
      execute: async () => ({ output: 'result', success: true }),
    });
    await expect(api.tools.execute('my-tool', {})).rejects.toThrow('lacks permission: tools:execute');
  });

  it('allows tools:execute with permission', async () => {
    const api = createApi(['tools:register', 'tools:execute']);
    api.tools.register({
      definition: { name: 'my-tool', description: 'Test', parameters: { type: 'object', properties: {} } },
      execute: async () => ({ output: 'result', success: true }),
    });
    const result = await api.tools.execute('my-tool', {});
    expect(result.success).toBe(true);
    expect(result.output).toBe('result');
  });

  it('checks sandbox for tool execution', async () => {
    sandbox.setSessionPolicy('test-plugin', { allowedTools: new Set(), blockedTools: new Set(['test-plugin:dangerous']) });
    const api = createApi(['tools:register', 'tools:execute']);
    api.tools.register({
      definition: { name: 'dangerous', description: 'Dangerous', parameters: { type: 'object', properties: {} } },
      execute: async () => ({ output: 'oops', success: true }),
    });
    await expect(api.tools.execute('dangerous', {})).rejects.toThrow('sandbox blocked');
  });

  it('allows execution when sandbox permits', async () => {
    sandbox.setSessionPolicy('test-plugin', { allowedTools: new Set(['test-plugin:my-tool']), blockedTools: new Set() });
    const api = createApi(['tools:register', 'tools:execute']);
    api.tools.register({
      definition: { name: 'my-tool', description: 'Safe', parameters: { type: 'object', properties: {} } },
      execute: async () => ({ output: 'safe', success: true }),
    });
    const result = await api.tools.execute('my-tool', {});
    expect(result.success).toBe(true);
  });

  it('works without sandbox (no sandbox passed)', async () => {
    const noSandboxApi = new PluginAPIImpl(
      'test-no-sandbox',
      { name: 'test-no-sandbox', version: '1.0.0', description: 'Test', permissions: ['tools:register', 'tools:execute'] },
      tools, hooks, config, memory, provider, (err) => errors.push(err),
    );
    noSandboxApi.tools.register({
      definition: { name: 'free-tool', description: 'Free', parameters: { type: 'object', properties: {} } },
      execute: async () => ({ output: 'free', success: true }),
    });
    const result = await noSandboxApi.tools.execute('free-tool', {});
    expect(result.success).toBe(true);
  });

  it('throws for unknown tool in execute', async () => {
    const api = createApi(['tools:execute']);
    await expect(api.tools.execute('nonexistent', {})).rejects.toThrow('Tool not found');
  });

  it('sandbox field in manifest is validated', async () => {
    const { validateManifest } = await import('../../src/plugins/loader.js');
    const manifest = validateManifest({
      name: 'sandboxed-plugin',
      version: '1.0.0',
      description: 'With sandbox',
      permissions: ['tools:register'],
      sandbox: { mode: 'read-only', network: 'deny-all', allowedDomains: [] },
    });
    expect(manifest.sandbox?.mode).toBe('read-only');
    expect(manifest.sandbox?.network).toBe('deny-all');
  });
});
