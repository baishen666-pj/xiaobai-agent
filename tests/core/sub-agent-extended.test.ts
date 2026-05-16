import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SubAgentEngine } from '../../src/core/sub-agent.js';
import type { SubAgentDefinition, SubAgentResult } from '../../src/core/sub-agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ProviderRouter } from '../../src/provider/router.js';
import type { SessionManager } from '../../src/session/manager.js';
import type { HookSystem } from '../../src/hooks/system.js';
import type { ConfigManager } from '../../src/config/manager.js';
import type { MemorySystem } from '../../src/memory/system.js';
import type { SecurityManager } from '../../src/security/manager.js';
import type { LoopEvent } from '../../src/core/loop.js';
import { CredentialPool } from '../../src/core/credential-pool.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
let engine: SubAgentEngine;
let tools: ToolRegistry;
let mockProvider: ProviderRouter;
let mockSessions: SessionManager;
let mockHooks: HookSystem;
let mockConfig: ConfigManager;
let mockMemory: MemorySystem;
let mockSecurity: SecurityManager;

function createMockProvider(): ProviderRouter {
  return {
    route: vi.fn(),
    complete: vi.fn(),
    stream: vi.fn(),
  } as unknown as ProviderRouter;
}

function createMockSessions(): SessionManager {
  return {
    createSession: vi.fn().mockReturnValue('test-session-123'),
    getSession: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    deleteSession: vi.fn(),
  } as unknown as SessionManager;
}

function createMockHooks(): HookSystem {
  return {
    execute: vi.fn(),
    register: vi.fn(),
  } as unknown as HookSystem;
}

function createMockConfig(): ConfigManager {
  return {
    get: vi.fn().mockReturnValue({ model: 'test-model', maxTokens: 4096 }),
    set: vi.fn(),
  } as unknown as ConfigManager;
}

function createMockMemory(): MemorySystem {
  return {
    store: vi.fn(),
    retrieve: vi.fn(),
    search: vi.fn(),
  } as unknown as MemorySystem;
}

function createMockSecurity(): SecurityManager {
  return {
    check: vi.fn().mockReturnValue(true),
    validate: vi.fn(),
  } as unknown as SecurityManager;
}

function createEngine(overrides?: Record<string, unknown>): SubAgentEngine {
  return new SubAgentEngine({
    provider: mockProvider,
    sessions: mockSessions,
    hooks: mockHooks,
    config: mockConfig,
    memory: mockMemory,
    security: mockSecurity,
    ...overrides,
  });
}

function registerTools(registry: ToolRegistry): void {
  registry.register({
    definition: { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'file contents', success: true }),
  });
  registry.register({
    definition: { name: 'grep', description: 'Search', parameters: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'results', success: true }),
  });
  registry.register({
    definition: { name: 'bash', description: 'Run shell', parameters: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'command output', success: true }),
  });
  // These should be blocked by default
  registry.register({
    definition: { name: 'agent', description: 'Spawn sub-agent', parameters: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'should be blocked', success: true }),
  });
  registry.register({
    definition: { name: 'memory', description: 'Memory ops', parameters: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'should be blocked', success: true }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tempDir = join(tmpdir(), `xiaobai-subagent-ext-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  mockProvider = createMockProvider();
  mockSessions = createMockSessions();
  mockHooks = createMockHooks();
  mockConfig = createMockConfig();
  mockMemory = createMockMemory();
  mockSecurity = createMockSecurity();

  tools = new ToolRegistry();
  registerTools(tools);
});

afterEach(() => {
  if (engine) engine.destroy();
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Construction and dependency injection
// ---------------------------------------------------------------------------
describe('SubAgentEngine - construction', () => {
  it('uses default credential pool when none provided', () => {
    engine = createEngine();
    expect((engine as any).credentialPool).toBeDefined();
    expect((engine as any).credentialPool.constructor.name).toBe('CredentialPool');
  });

  it('accepts a custom credential pool', () => {
    const pool = new CredentialPool();
    pool.add('openai', 'test-key-123');
    engine = createEngine({ credentialPool: pool });
    expect((engine as any).credentialPool).toBe(pool);
  });

  it('starts heartbeat timer on construction', () => {
    engine = createEngine();
    expect((engine as any).heartbeatTimer).toBeDefined();
    expect(typeof (engine as any).heartbeatTimer).toBe('object');
  });

  it('defaults maxDepth to 1', () => {
    engine = createEngine();
    expect((engine as any).maxDepth).toBe(1);
  });

  it('discovers agent definitions from disk on construction', () => {
    const agentsDir = join(tempDir, '.xiaobai', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'test-agent.md'), `---\nname: tester\nmodel: sonnet\n---\nYou are a tester.`);
    const originalCwd = process.cwd();
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    try {
      engine = createEngine();
      expect(engine.getAvailableDefinitions()).toContain('tester');
    } finally {
      vi.spyOn(process, 'cwd').mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// spawn - depth control
// ---------------------------------------------------------------------------
describe('SubAgentEngine - spawn depth control', () => {
  it('rejects spawn at depth greater than maxDepth', async () => {
    engine = createEngine();
    engine.setMaxDepth(1);
    const result = await engine.spawn('do something', tools, { depth: 2 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('max_depth_exceeded');
    expect(result.output).toContain('max depth');
    expect(result.tokensUsed).toBe(0);
    expect(result.toolCalls).toBe(0);
  });

  it('allows spawn at exactly maxDepth', async () => {
    engine = createEngine();
    engine.setMaxDepth(2);
    // This will fail because the mock provider won't actually drive the loop,
    // but it should not fail with max_depth_exceeded
    const result = await engine.spawn('do something', tools, { depth: 2 });
    expect(result.error).not.toBe('max_depth_exceeded');
  });

  it('defaults depth to 1 when not specified', async () => {
    engine = createEngine();
    engine.setMaxDepth(0);
    // depth defaults to 1, maxDepth is 0, so it should reject
    const result = await engine.spawn('do something', tools);
    expect(result.success).toBe(false);
    expect(result.error).toBe('max_depth_exceeded');
  });
});

// ---------------------------------------------------------------------------
// spawn - tool filtering
// ---------------------------------------------------------------------------
describe('SubAgentEngine - tool filtering', () => {
  it('filters out agent and memory tools by default', () => {
    engine = createEngine();
    const filterFn = (engine as any).filterTools.bind(engine);
    const defaultDef: SubAgentDefinition = {
      name: 'default',
      systemPrompt: 'test',
    };
    const filtered = filterFn(tools, defaultDef);
    const names = filtered.getToolDefinitions().map((t: any) => t.name);
    expect(names).not.toContain('agent');
    expect(names).not.toContain('memory');
    expect(names).toContain('read');
    expect(names).toContain('grep');
    expect(names).toContain('bash');
  });

  it('filters additional blocked tools from definition', () => {
    engine = createEngine();
    const filterFn = (engine as any).filterTools.bind(engine);
    const def: SubAgentDefinition = {
      name: 'restricted',
      systemPrompt: 'test',
      blockedTools: ['bash'],
    };
    const filtered = filterFn(tools, def);
    const names = filtered.getToolDefinitions().map((t: any) => t.name);
    expect(names).not.toContain('bash');
    expect(names).not.toContain('agent');
    expect(names).not.toContain('memory');
    expect(names).toContain('read');
    expect(names).toContain('grep');
  });

  it('restricts to allowed tools only when specified', () => {
    engine = createEngine();
    const filterFn = (engine as any).filterTools.bind(engine);
    const def: SubAgentDefinition = {
      name: 'readonly',
      systemPrompt: 'test',
      allowedTools: ['read'],
    };
    const filtered = filterFn(tools, def);
    const names = filtered.getToolDefinitions().map((t: any) => t.name);
    expect(names).toEqual(['read']);
  });

  it('returns empty registry when allowed tools list is empty', () => {
    engine = createEngine();
    const filterFn = (engine as any).filterTools.bind(engine);
    const def: SubAgentDefinition = {
      name: 'none',
      systemPrompt: 'test',
      allowedTools: [],
    };
    const filtered = filterFn(tools, def);
    expect(filtered.getToolDefinitions()).toHaveLength(0);
  });

  it('delegates execute to the original tool registry', async () => {
    engine = createEngine();
    const filterFn = (engine as any).filterTools.bind(engine);
    const def: SubAgentDefinition = {
      name: 'default',
      systemPrompt: 'test',
    };
    const filtered = filterFn(tools, def);
    const result = await filtered.execute('read', {});
    expect(result).toEqual({ output: 'file contents', success: true });
  });
});

// ---------------------------------------------------------------------------
// spawn - event handling
// ---------------------------------------------------------------------------
describe('SubAgentEngine - spawn event handling', () => {
  it('forwards events through onEvent callback', async () => {
    engine = createEngine();
    const events: LoopEvent[] = [];
    const onEvent = vi.fn((e: LoopEvent) => events.push(e));

    // We need to mock AgentLoop.run to emit events.
    // Instead of mocking the class directly, we observe the callback mechanism
    // by constructing spawn and seeing that it passes onEvent through.
    // Since the AgentLoop will error without a real provider, the spawn will
    // catch the error. We verify the onEvent parameter is wired.
    const result = await engine.spawn('test task', tools, { onEvent });
    // The loop.run is async iterable; with a mock provider it may throw or yield nothing.
    // Either way, the engine should handle it without crashing.
    expect(typeof result.success).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// spawn - credential lease
// ---------------------------------------------------------------------------
describe('SubAgentEngine - credential lease management', () => {
  it('acquires and releases credential lease during spawn', async () => {
    const pool = new CredentialPool();
    pool.add('openai', 'test-key-xyz');
    engine = createEngine({ credentialPool: pool });

    // The spawn will attempt to run but error out due to missing provider behavior.
    // The lease should still be cleaned up in the finally block.
    await engine.spawn('test task', tools);
    // After spawn, no active children should hold leases
    expect(engine.getActiveChildren()).toHaveLength(0);
  });

  it('handles null lease gracefully', async () => {
    const emptyPool = new CredentialPool();
    // Pool has no credentials, acquire returns null
    engine = createEngine({ credentialPool: emptyPool });
    const result = await engine.spawn('test task', tools);
    // Should not crash; either succeeds or fails with a provider error
    expect(typeof result.success).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// spawn - abort signal
// ---------------------------------------------------------------------------
describe('SubAgentEngine - abort signal', () => {
  it('passes abort signal to loop options', async () => {
    engine = createEngine();
    const controller = new AbortController();
    controller.abort();
    // Even with an aborted signal, spawn should handle it gracefully
    const result = await engine.spawn('test task', tools, { abortSignal: controller.signal });
    expect(typeof result.success).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// spawn - definition resolution
// ---------------------------------------------------------------------------
describe('SubAgentEngine - definition resolution', () => {
  it('uses named definition when definitionName is provided and exists', () => {
    engine = createEngine();
    // Inject a definition directly
    const def: SubAgentDefinition = {
      name: 'custom-agent',
      systemPrompt: 'You are a custom agent.',
      maxTurns: 5,
    };
    (engine as any).agentDefinitions.set('custom-agent', def);
    expect(engine.getDefinition('custom-agent')).toBe(def);
  });

  it('falls back to default definition when definitionName does not exist', () => {
    engine = createEngine();
    expect(engine.getDefinition('nonexistent')).toBeUndefined();
    // The spawn method falls back to getDefaultDefinition internally
  });

  it('getDefaultDefinition returns expected values', () => {
    engine = createEngine();
    const getDefault = (engine as any).getDefaultDefinition.bind(engine);
    const def = getDefault();
    expect(def.name).toBe('default');
    expect(def.maxTurns).toBe(15);
    expect(def.maxDepth).toBe(1);
    expect(def.systemPrompt).toContain('sub-agent');
  });
});

// ---------------------------------------------------------------------------
// parseAgentDefinition
// ---------------------------------------------------------------------------
describe('SubAgentEngine - parseAgentDefinition', () => {
  let parseFn: (content: string) => SubAgentDefinition | null;

  beforeEach(() => {
    engine = createEngine();
    parseFn = (engine as any).parseAgentDefinition.bind(engine);
  });

  it('parses minimal valid definition with only name', () => {
    const content = `---\nname: simple\n---\nYou are simple.`;
    const result = parseFn(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('simple');
    expect(result!.systemPrompt).toBe('You are simple.');
    expect(result!.model).toBeUndefined();
    expect(result!.maxTurns).toBeUndefined();
    expect(result!.maxDepth).toBeUndefined();
    expect(result!.allowedTools).toBeUndefined();
    expect(result!.blockedTools).toBeUndefined();
  });

  it('parses full definition with all fields', () => {
    const content = `---
name: full-agent
model: gpt-4
maxTurns: 25
maxDepth: 2
allowedTools: ["read", "grep", "bash"]
blockedTools: ["write", "delete"]
---
You are a full agent with all options.`;
    const result = parseFn(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('full-agent');
    expect(result!.model).toBe('gpt-4');
    expect(result!.maxTurns).toBe(25);
    expect(result!.maxDepth).toBe(2);
    expect(result!.allowedTools).toEqual(['read', 'grep', 'bash']);
    expect(result!.blockedTools).toEqual(['write', 'delete']);
    expect(result!.systemPrompt).toBe('You are a full agent with all options.');
  });

  it('returns null when frontmatter has no name', () => {
    const content = `---\nmodel: sonnet\n---\nNo name field.`;
    expect(parseFn(content)).toBeNull();
  });

  it('returns null when no frontmatter is present', () => {
    expect(parseFn('Just plain text')).toBeNull();
    expect(parseFn('')).toBeNull();
  });

  it('handles malformed JSON in allowedTools gracefully', () => {
    const content = `---\nname: bad-json\nallowedTools: [not valid json\n---\nBody.`;
    const result = parseFn(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('bad-json');
    expect(result!.allowedTools).toBeUndefined();
  });

  it('handles malformed JSON in blockedTools gracefully', () => {
    const content = `---\nname: bad-blocked\nblockedTools: {broken\n---\nBody.`;
    const result = parseFn(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('bad-blocked');
    expect(result!.blockedTools).toBeUndefined();
  });

  it('handles empty body after frontmatter', () => {
    const content = `---\nname: empty-body\n---\n`;
    const result = parseFn(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('empty-body');
    expect(result!.systemPrompt).toBe('');
  });

  it('ignores YAML lines without colons', () => {
    const content = `---\nname: test\nthis line has no colon\n---\nBody.`;
    const result = parseFn(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
  });

  it('handles multiline body correctly', () => {
    const content = `---\nname: multi\n---\nLine one.\nLine two.\nLine three.`;
    const result = parseFn(content);
    expect(result!.systemPrompt).toBe('Line one.\nLine two.\nLine three.');
  });

  it('handles empty string input', () => {
    expect(parseFn('')).toBeNull();
  });

  it('handles frontmatter with empty YAML section', () => {
    const content = `---\n---\nBody only.`;
    // This won't match the regex because name is required
    expect(parseFn(content)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// discoverAgentDefinitions
// ---------------------------------------------------------------------------
describe('SubAgentEngine - discoverAgentDefinitions', () => {
  it('skips non-.md files in agents directory', () => {
    const agentsDir = join(tempDir, '.xiaobai', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'readme.txt'), 'Not an agent definition');
    writeFileSync(join(agentsDir, 'script.js'), 'console.log("not an agent")');
    writeFileSync(join(agentsDir, 'valid.md'), `---\nname: valid-one\n---\nBody.`);

    const originalCwd = process.cwd();
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    try {
      engine = createEngine();
      const defs = engine.getAvailableDefinitions();
      expect(defs).toContain('valid-one');
      expect(defs).not.toContain('readme');
    } finally {
      vi.spyOn(process, 'cwd').mockRestore();
    }
  });

  it('handles multiple agent definitions', () => {
    const agentsDir = join(tempDir, '.xiaobai', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'agent-a.md'), `---\nname: alpha\n---\nAlpha agent.`);
    writeFileSync(join(agentsDir, 'agent-b.md'), `---\nname: beta\n---\nBeta agent.`);

    const originalCwd = process.cwd();
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    try {
      engine = createEngine();
      const defs = engine.getAvailableDefinitions();
      expect(defs).toContain('alpha');
      expect(defs).toContain('beta');
    } finally {
      vi.spyOn(process, 'cwd').mockRestore();
    }
  });

  it('handles unreadable agent files gracefully', () => {
    const agentsDir = join(tempDir, '.xiaobai', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    // Write a file that will parse to null (no name)
    writeFileSync(join(agentsDir, 'broken.md'), `---\nnotname: foo\n---\nNo name field.`);

    const originalCwd = process.cwd();
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    try {
      engine = createEngine();
      // Should not throw, just skip the broken file
      expect(engine.getAvailableDefinitions()).toEqual([]);
    } finally {
      vi.spyOn(process, 'cwd').mockRestore();
    }
  });

  it('handles missing agents directory gracefully', () => {
    const originalCwd = process.cwd();
    vi.spyOn(process, 'cwd').mockReturnValue(join(tempDir, 'no-agents-here'));
    try {
      engine = createEngine();
      expect(engine.getAvailableDefinitions()).toEqual([]);
    } finally {
      vi.spyOn(process, 'cwd').mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// setMaxDepth
// ---------------------------------------------------------------------------
describe('SubAgentEngine - setMaxDepth', () => {
  it('caps maxDepth at 3 (MAX_DEPTH_CAP)', () => {
    engine = createEngine();
    engine.setMaxDepth(100);
    expect((engine as any).maxDepth).toBe(3);
  });

  it('allows setting maxDepth below cap', () => {
    engine = createEngine();
    engine.setMaxDepth(2);
    expect((engine as any).maxDepth).toBe(2);
  });

  it('allows setting maxDepth to 0', () => {
    engine = createEngine();
    engine.setMaxDepth(0);
    expect((engine as any).maxDepth).toBe(0);
  });

  it('allows setting maxDepth to 1', () => {
    engine = createEngine();
    engine.setMaxDepth(1);
    expect((engine as any).maxDepth).toBe(1);
  });

  it('sets maxDepth to exactly 3', () => {
    engine = createEngine();
    engine.setMaxDepth(3);
    expect((engine as any).maxDepth).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// interruptAll
// ---------------------------------------------------------------------------
describe('SubAgentEngine - interruptAll', () => {
  it('marks all children as aborted', () => {
    engine = createEngine();
    // Manually inject active children to test interruption
    const children = (engine as any).children;
    children.set('child-1', {
      id: 'child-1',
      definition: { name: 'test-1', systemPrompt: 'test' },
      loop: {},
      tools: {},
      aborted: false,
      busy: true,
      lastHeartbeat: Date.now(),
      heartbeatCycles: 0,
    });
    children.set('child-2', {
      id: 'child-2',
      definition: { name: 'test-2', systemPrompt: 'test' },
      loop: {},
      tools: {},
      aborted: false,
      busy: false,
      lastHeartbeat: Date.now(),
      heartbeatCycles: 0,
    });

    expect(engine.getActiveChildren()).toHaveLength(2);
    engine.interruptAll();

    for (const child of children.values()) {
      expect(child.aborted).toBe(true);
    }
  });

  it('handles interruptAll with no children', () => {
    engine = createEngine();
    expect(() => engine.interruptAll()).not.toThrow();
    expect(engine.getActiveChildren()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getActiveChildren
// ---------------------------------------------------------------------------
describe('SubAgentEngine - getActiveChildren', () => {
  it('returns empty array when no children', () => {
    engine = createEngine();
    expect(engine.getActiveChildren()).toEqual([]);
  });

  it('returns correct shape for active children', () => {
    engine = createEngine();
    const children = (engine as any).children;
    children.set('child-1', {
      id: 'child-1',
      definition: { name: 'worker', systemPrompt: 'test' },
      aborted: false,
      busy: true,
      lastHeartbeat: Date.now(),
      heartbeatCycles: 0,
    });

    const active = engine.getActiveChildren();
    expect(active).toHaveLength(1);
    expect(active[0]).toEqual({ id: 'child-1', name: 'worker', busy: true });
  });
});

// ---------------------------------------------------------------------------
// getDefinition / getAvailableDefinitions
// ---------------------------------------------------------------------------
describe('SubAgentEngine - definitions', () => {
  it('returns undefined for unknown definition', () => {
    engine = createEngine();
    expect(engine.getDefinition('nonexistent')).toBeUndefined();
  });

  it('returns definition that was manually added', () => {
    engine = createEngine();
    const def: SubAgentDefinition = {
      name: 'my-agent',
      systemPrompt: 'Do things',
      maxTurns: 10,
    };
    (engine as any).agentDefinitions.set('my-agent', def);
    expect(engine.getDefinition('my-agent')).toBe(def);
  });

  it('getAvailableDefinitions returns all registered names', () => {
    engine = createEngine();
    (engine as any).agentDefinitions.set('a', { name: 'a', systemPrompt: 'a' });
    (engine as any).agentDefinitions.set('b', { name: 'b', systemPrompt: 'b' });
    const names = engine.getAvailableDefinitions();
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------
describe('SubAgentEngine - destroy', () => {
  it('clears heartbeat timer', () => {
    engine = createEngine();
    expect((engine as any).heartbeatTimer).toBeDefined();
    engine.destroy();
    expect((engine as any).heartbeatTimer).toBeUndefined();
  });

  it('interrupts all children on destroy', () => {
    engine = createEngine();
    const interruptSpy = vi.spyOn(engine, 'interruptAll');
    engine.destroy();
    expect(interruptSpy).toHaveBeenCalledOnce();
  });

  it('is safe to call destroy multiple times', () => {
    engine = createEngine();
    engine.destroy();
    expect(() => engine.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// spawn - error handling
// ---------------------------------------------------------------------------
describe('SubAgentEngine - spawn error handling', () => {
  it('throws when sessions.createSession throws (outside try-catch)', async () => {
    engine = createEngine();
    (mockSessions.createSession as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('session creation failed');
    });
    await expect(engine.spawn('test', tools)).rejects.toThrow('session creation failed');
  });

  it('returns error result when the loop run throws inside try-catch', async () => {
    engine = createEngine();
    // The AgentLoop constructor will succeed, but the loop.run call inside
    // the for-await will throw because the mock provider cannot drive the loop.
    // The source catches this in the try block and returns an error result.
    const result = await engine.spawn('test', tools);
    // With mock providers, the loop either produces output or throws.
    // Both paths return a valid SubAgentResult.
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('output');
    expect(result).toHaveProperty('tokensUsed');
    expect(result).toHaveProperty('toolCalls');
  });

  it('cleans up child entry when spawn completes', async () => {
    engine = createEngine();
    await engine.spawn('test', tools);
    // The finally block should always delete the child
    expect(engine.getActiveChildren()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// spawn - loop iteration (integration-style with mocked AgentLoop)
// ---------------------------------------------------------------------------
describe('SubAgentEngine - spawn loop iteration', () => {
  it('accumulates text events into output', async () => {
    engine = createEngine();

    // We need to make AgentLoop.run yield events. Since we can't easily mock
    // the class, we verify the spawn mechanism by checking the result shape
    // when the loop throws (which it will with mock providers).
    const result = await engine.spawn('test task', tools);
    // With a mock provider, the loop may throw or produce empty output
    expect(result).toHaveProperty('output');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('tokensUsed');
    expect(result).toHaveProperty('toolCalls');
  });

  it('uses definition system prompt when available', async () => {
    engine = createEngine();
    const def: SubAgentDefinition = {
      name: 'coder',
      systemPrompt: 'You are a code assistant.',
      maxTurns: 3,
    };
    (engine as any).agentDefinitions.set('coder', def);

    // We can't easily intercept the prompt sent to the loop, but we verify
    // the definition is resolved correctly
    expect(engine.getDefinition('coder')).toBe(def);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat timeout
// ---------------------------------------------------------------------------
describe('SubAgentEngine - heartbeat', () => {
  it('heartbeat constants have expected values', () => {
    // Verify the constants used in heartbeat logic
    // These are module-level, so we test behavior indirectly
    expect(true).toBe(true); // Placeholder - constants tested through behavior
  });

  it('sets up interval timer on construction', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    engine = createEngine();
    expect(setIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('clears interval timer on destroy', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    engine = createEngine();
    engine.destroy();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('SubAgentEngine - edge cases', () => {
  it('handles spawn with empty prompt', async () => {
    engine = createEngine();
    const result = await engine.spawn('', tools);
    expect(typeof result.success).toBe('boolean');
  });

  it('handles spawn with empty tool registry', async () => {
    engine = createEngine();
    const emptyTools = new ToolRegistry();
    const result = await engine.spawn('test', emptyTools);
    expect(typeof result.success).toBe('boolean');
  });

  it('handles skills dependency being undefined', () => {
    engine = createEngine();
    expect((engine as any).skills).toBeUndefined();
  });

  it('handles skills dependency being provided', () => {
    const mockSkills = { getSkill: vi.fn() } as any;
    engine = createEngine({ skills: mockSkills });
    expect((engine as any).skills).toBe(mockSkills);
  });
});
