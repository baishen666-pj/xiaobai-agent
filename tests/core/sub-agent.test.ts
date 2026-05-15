import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubAgentEngine } from '../../src/core/sub-agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { SessionManager } from '../../src/session/manager.js';
import { HookSystem } from '../../src/hooks/system.js';
import { ConfigManager } from '../../src/config/manager.js';
import { MemorySystem } from '../../src/memory/system.js';
import { SecurityManager } from '../../src/security/manager.js';
import { ProviderRouter } from '../../src/provider/router.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
let engine: SubAgentEngine;
let tools: ToolRegistry;

function createEngine(): SubAgentEngine {
  const config = new ConfigManager();
  const provider = new ProviderRouter(config.get());
  const sessions = new SessionManager(tempDir);
  const hooks = new HookSystem(tempDir);
  const memory = new MemorySystem(tempDir);
  const security = new SecurityManager(config.get());

  return new SubAgentEngine({
    provider,
    sessions,
    hooks,
    config,
    memory,
    security,
  });
}

beforeEach(() => {
  tempDir = join(tmpdir(), `xiaobai-subagent-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  tools = new ToolRegistry();
  tools.register({
    definition: { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'file contents', success: true }),
  });
  tools.register({
    definition: { name: 'grep', description: 'Search', parameters: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'results', success: true }),
  });
  tools.register({
    definition: { name: 'agent', description: 'Spawn sub-agent', parameters: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'should be blocked', success: true }),
  });
});

afterEach(() => {
  if (engine) engine.destroy();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SubAgentEngine', () => {
  it('rejects spawn when max depth exceeded', async () => {
    engine = createEngine();
    engine.setMaxDepth(0);
    const result = await engine.spawn('test task', tools);
    expect(result.success).toBe(false);
    expect(result.error).toBe('max_depth_exceeded');
  });

  it('filters blocked tools from child', async () => {
    engine = createEngine();
    const activeBefore = engine.getActiveChildren();
    expect(activeBefore).toHaveLength(0);
  });

  it('returns available definitions', () => {
    engine = createEngine();
    const defs = engine.getAvailableDefinitions();
    expect(Array.isArray(defs)).toBe(true);
  });

  it('setMaxDepth caps at 3', () => {
    engine = createEngine();
    engine.setMaxDepth(10);
    expect((engine as any).maxDepth).toBe(3);
  });

  it('interrupts all children', () => {
    engine = createEngine();
    engine.interruptAll();
    expect(engine.getActiveChildren()).toHaveLength(0);
  });

  it('parses agent definition from markdown with YAML frontmatter', () => {
    engine = createEngine();
    const parseFn = (engine as any).parseAgentDefinition.bind(engine);

    const valid = `---
name: code-reviewer
model: sonnet
maxTurns: 10
allowedTools: ["read", "grep"]
blockedTools: ["bash"]
---
You are a code reviewer.`;

    const result = parseFn(valid);
    expect(result.name).toBe('code-reviewer');
    expect(result.model).toBe('sonnet');
    expect(result.maxTurns).toBe(10);
    expect(result.allowedTools).toEqual(['read', 'grep']);
    expect(result.blockedTools).toEqual(['bash']);
    expect(result.systemPrompt).toBe('You are a code reviewer.');
  });

  it('returns null for definition without name', () => {
    engine = createEngine();
    const parseFn = (engine as any).parseAgentDefinition.bind(engine);
    const result = parseFn('---\nmodel: sonnet\n---\nNo name');
    expect(result).toBeNull();
  });

  it('returns null for content without frontmatter', () => {
    engine = createEngine();
    const parseFn = (engine as any).parseAgentDefinition.bind(engine);
    const result = parseFn('Just some markdown content');
    expect(result).toBeNull();
  });
});
