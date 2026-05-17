import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Tracer } from '../../src/telemetry/tracer.js';

// ---------------------------------------------------------------------------
// Mock providers for ProviderRouter tests
// ---------------------------------------------------------------------------

const mockChat = vi.fn();

function createMockProvider() {
  return {
    name: 'mock',
    chat: mockChat,
  } as import('../../src/provider/types.js').LLMProvider;
}

const mockProvider = createMockProvider();

vi.mock('../../src/provider/anthropic.js', () => ({
  AnthropicProvider: vi.fn(() => mockProvider),
}));
vi.mock('../../src/provider/openai.js', () => ({
  OpenAICompatibleProvider: vi.fn(() => mockProvider),
}));
vi.mock('../../src/provider/google.js', () => ({
  GoogleProvider: vi.fn(() => mockProvider),
}));

// Import SUT after mocks
import { ProviderRouter } from '../../src/provider/router.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { XiaobaiConfig } from '../../src/config/manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<XiaobaiConfig> = {}): XiaobaiConfig {
  return {
    model: { default: 'gpt-4', fallback: 'gpt-3.5-turbo' },
    provider: { default: 'openai', apiKey: 'test-key' },
    memory: { enabled: false, memoryCharLimit: 1000, userCharLimit: 500 },
    skills: { enabled: false },
    ...overrides,
  } as XiaobaiConfig;
}

// ---------------------------------------------------------------------------
// ProviderRouter + Tracer integration
// ---------------------------------------------------------------------------

describe('ProviderRouter with tracer', () => {
  let tracer: Tracer;

  beforeEach(() => {
    tracer = new Tracer({ enabled: true, maxTraces: 50 });
    mockChat.mockReset();
    mockChat.mockResolvedValue({
      content: 'Hi!',
      stopReason: 'end_turn',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  });

  it('creates a span for chat()', async () => {
    const router = new ProviderRouter(makeConfig(), { tracer });
    await router.chat([{ role: 'user', content: 'Hello', timestamp: Date.now() }]);

    const traces = tracer.getRecentTraces();
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const rootSpan = traces[0].rootSpan;
    expect(rootSpan.name).toBe('provider.chat');
    expect(rootSpan.attributes).toHaveProperty('provider', 'openai');
    expect(rootSpan.attributes).toHaveProperty('model', 'gpt-4');
    expect(rootSpan.attributes).toHaveProperty('tokens', 15);
    expect(rootSpan.status).toBe('ok');
  });

  it('sets span status to error on chat failure', async () => {
    const noFallbackConfig = makeConfig({ model: { default: 'gpt-4' } });
    const router = new ProviderRouter(noFallbackConfig, { tracer });
    mockChat.mockRejectedValue(new Error('API error'));

    await expect(router.chat([{ role: 'user', content: 'Hello', timestamp: Date.now() }]))
      .rejects.toThrow('API error');

    const traces = tracer.getRecentTraces();
    expect(traces.length).toBeGreaterThanOrEqual(1);
    expect(traces[0].rootSpan.status).toBe('error');
  });

  it('works without tracer (no-op)', async () => {
    const router = new ProviderRouter(makeConfig());
    const result = await router.chat([{ role: 'user', content: 'Hello', timestamp: Date.now() }]);
    expect(result).toBeDefined();
    // No tracer means no traces, but no error either
  });

  it('captures correct provider and model attributes', async () => {
    const config = makeConfig({
      provider: { default: 'anthropic', apiKey: 'test-key' },
      model: { default: 'claude-3' },
    });
    const router = new ProviderRouter(config, { tracer });
    await router.chat([{ role: 'user', content: 'Hi', timestamp: Date.now() }]);

    const traces = tracer.getRecentTraces();
    expect(traces).toHaveLength(1);
    const span = traces[0].rootSpan;
    expect(span.attributes.provider).toBe('anthropic');
    expect(span.attributes.model).toBe('claude-3');
    expect(span.kind).toBe('client');
  });
});

// ---------------------------------------------------------------------------
// ToolRegistry + Tracer integration
// ---------------------------------------------------------------------------

describe('ToolRegistry with tracer', () => {
  let tracer: Tracer;

  beforeEach(() => {
    tracer = new Tracer({ enabled: true, maxTraces: 50 });
  });

  it('creates a span for tool execution', async () => {
    const registry = new ToolRegistry();
    registry.setTracer(tracer);

    const mockExecute = vi.fn().mockResolvedValue({
      output: 'file contents',
      success: true,
    });

    registry.register({
      definition: {
        name: 'read_file',
        description: 'Reads a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
        },
      },
      execute: mockExecute,
    });

    const result = await registry.execute('read_file', { path: '/tmp/test.txt' });
    expect(result.success).toBe(true);

    const traces = tracer.getRecentTraces();
    expect(traces.length).toBeGreaterThanOrEqual(1);
    expect(traces[0].rootSpan.name).toBe('tool.read_file');
    expect(traces[0].rootSpan.attributes).toHaveProperty('tool', 'read_file');
    expect(traces[0].rootSpan.attributes).toHaveProperty('success', true);
    expect(traces[0].rootSpan.status).toBe('ok');
  });

  it('sets error status on tool failure', async () => {
    const registry = new ToolRegistry();
    registry.setTracer(tracer);

    const mockExecute = vi.fn().mockRejectedValue(new Error('disk error'));

    registry.register({
      definition: {
        name: 'write_file',
        description: 'Writes a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
        },
      },
      execute: mockExecute,
    });

    const result = await registry.execute('write_file', { path: '/tmp/test.txt' });
    expect(result.success).toBe(false);

    const traces = tracer.getRecentTraces();
    expect(traces.length).toBeGreaterThanOrEqual(1);
    expect(traces[0].rootSpan.name).toBe('tool.write_file');
    expect(traces[0].rootSpan.status).toBe('error');
  });

  it('does not create spans when tracer is not set', async () => {
    const registry = new ToolRegistry();

    const mockExecute = vi.fn().mockResolvedValue({
      output: 'result',
      success: true,
    });

    registry.register({
      definition: {
        name: 'grep',
        description: 'Searches',
        parameters: { type: 'object', properties: {} },
      },
      execute: mockExecute,
    });

    const result = await registry.execute('grep', {});
    expect(result.success).toBe(true);
  });

  it('does not create spans for unknown tools', async () => {
    const registry = new ToolRegistry();
    registry.setTracer(tracer);

    const result = await registry.execute('nonexistent_tool', {});
    expect(result.success).toBe(false);

    const traces = tracer.getRecentTraces();
    expect(traces).toHaveLength(0);
  });
});
