import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { StructuredOutputAdapter } from '../../src/structured/adapter.js';
import type { ChatOptions, LLMProvider, ProviderResponse } from '../../src/provider/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(name: string): LLMProvider {
  return { name, chat: async () => ({ content: '' }) };
}

function makeConfig(overrides: Partial<import('../../src/structured/types.js').StructuredOutputConfig> = {}) {
  return {
    schema: z.object({ text: z.string() }),
    ...overrides,
  };
}

const adapter = new StructuredOutputAdapter();

// ---------------------------------------------------------------------------
// adaptChatOptions
// ---------------------------------------------------------------------------

describe('StructuredOutputAdapter.adaptChatOptions', () => {
  it('returns options unchanged when no structured config', () => {
    const provider = makeProvider('openai');
    const options: ChatOptions = { temperature: 0.7 };

    const result = adapter.adaptChatOptions(provider, options);

    expect(result.chatOptions).toEqual(options);
    expect(result.meta).toBeNull();
  });

  it('injects system prompt for prompt_based mode (none-capability provider)', () => {
    const provider = makeProvider('ollama');
    const options: ChatOptions = {
      structured: makeConfig({ mode: 'auto' }),
    };

    const result = adapter.adaptChatOptions(provider, options);

    expect(result.meta).not.toBeNull();
    expect(result.meta!.mode).toBe('prompt_based');
    expect(result.chatOptions.system).toContain('You must respond with valid JSON');
  });

  it('injects system prompt when explicitly requesting prompt_based', () => {
    const provider = makeProvider('openai');
    const options: ChatOptions = {
      structured: makeConfig({ mode: 'prompt_based' }),
    };

    const result = adapter.adaptChatOptions(provider, options);

    expect(result.meta!.mode).toBe('prompt_based');
    expect(result.chatOptions.system).toContain('You must respond with valid JSON');
  });

  it('sets response_format for json_schema capability (openai)', () => {
    const provider = makeProvider('openai');
    const options: ChatOptions = {
      structured: makeConfig({ name: 'my_output' }),
    };

    const result = adapter.adaptChatOptions(provider, options);

    expect(result.meta!.mode).toBe('provider_native');
    expect((result.chatOptions as any).response_format).toBeDefined();
    expect((result.chatOptions as any).response_format.type).toBe('json_schema');
    expect((result.chatOptions as any).response_format.json_schema.name).toBe('my_output');
    expect((result.chatOptions as any).response_format.json_schema.strict).toBe(true);
  });

  it('uses default name "structured_output" when name is not provided for json_schema', () => {
    const provider = makeProvider('openai');
    const options: ChatOptions = {
      structured: makeConfig(),
    };

    const result = adapter.adaptChatOptions(provider, options);

    expect((result.chatOptions as any).response_format.json_schema.name).toBe('structured_output');
  });

  it('injects pseudo tool + tool_choice for tool_use capability (anthropic)', () => {
    const provider = makeProvider('anthropic');
    const existingTool = { name: 'other_tool', description: 'desc', parameters: {} };
    const options: ChatOptions = {
      tools: [existingTool],
      structured: makeConfig({ name: 'my_structured', description: 'Extract data' }),
    };

    const result = adapter.adaptChatOptions(provider, options);

    expect(result.meta!.mode).toBe('provider_native');
    expect(result.meta!.structuredToolName).toBe('my_structured');
    const tools = (result.chatOptions as any).tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(2);
    expect(tools[1].name).toBe('my_structured');
    expect(tools[1].description).toBe('Extract data');
    expect((result.chatOptions as any).tool_choice).toEqual({
      type: 'tool',
      name: 'my_structured',
    });
  });

  it('uses default description for tool_use when none provided', () => {
    const provider = makeProvider('anthropic');
    const options: ChatOptions = {
      structured: makeConfig(),
    };

    const result = adapter.adaptChatOptions(provider, options);

    const tools = (result.chatOptions as any).tools as Array<Record<string, unknown>>;
    expect(tools[0].description).toBe('Respond with structured output');
  });

  it('sets response_format for json_object capability (deepseek)', () => {
    const provider = makeProvider('deepseek');
    const options: ChatOptions = {
      structured: makeConfig(),
    };

    const result = adapter.adaptChatOptions(provider, options);

    expect(result.meta!.mode).toBe('provider_native');
    expect((result.chatOptions as any).response_format).toEqual({ type: 'json_object' });
  });

  it('preserves other ChatOptions fields when adapting', () => {
    const provider = makeProvider('openai');
    const options: ChatOptions = {
      temperature: 0.5,
      maxTokens: 100,
      structured: makeConfig(),
    };

    const result = adapter.adaptChatOptions(provider, options);

    expect(result.chatOptions.temperature).toBe(0.5);
    expect(result.chatOptions.maxTokens).toBe(100);
  });

  it('falls back to prompt_based for unknown capability', () => {
    const provider = makeProvider('ollama');
    const options: ChatOptions = {
      structured: makeConfig({ mode: 'provider_native' }),
    };

    // ollama has 'none' capability, but mode is explicitly provider_native
    // The adapter code uses the capability to determine the strategy
    const result = adapter.adaptChatOptions(provider, options);

    // With 'none' capability, even provider_native falls back to prompt_based
    expect(result.chatOptions.system).toContain('You must respond with valid JSON');
  });
});

// ---------------------------------------------------------------------------
// adaptProviderResponse
// ---------------------------------------------------------------------------

describe('StructuredOutputAdapter.adaptProviderResponse', () => {
  it('returns response unchanged when meta is null', () => {
    const response: ProviderResponse = { content: 'hello' };

    const result = adapter.adaptProviderResponse(response, null);

    expect(result).toBe(response);
  });

  it('returns response unchanged when no toolCalls match structuredToolName', () => {
    const response: ProviderResponse = {
      content: 'original',
      toolCalls: [{ id: '1', name: 'other_tool', arguments: { a: 1 } }],
    };
    const meta = {
      config: makeConfig(),
      mode: 'provider_native' as const,
      jsonSchema: {},
      structuredToolName: 'structured_output',
    };

    const result = adapter.adaptProviderResponse(response, meta);

    expect(result.content).toBe('original');
  });

  it('extracts content from matching tool_use call', () => {
    const response: ProviderResponse = {
      content: '',
      toolCalls: [
        { id: '1', name: 'structured_output', arguments: { text: 'extracted' } },
        { id: '2', name: 'other_tool', arguments: { x: 1 } },
      ],
    };
    const meta = {
      config: makeConfig(),
      mode: 'provider_native' as const,
      jsonSchema: {},
      structuredToolName: 'structured_output',
    };

    const result = adapter.adaptProviderResponse(response, meta);

    expect(result.content).toBe('{"text":"extracted"}');
    // The structured tool call should be removed
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('other_tool');
  });

  it('returns response unchanged when mode is prompt_based', () => {
    const response: ProviderResponse = { content: '{"text":"raw"}' };
    const meta = {
      config: makeConfig(),
      mode: 'prompt_based' as const,
      jsonSchema: {},
    };

    const result = adapter.adaptProviderResponse(response, meta);

    expect(result.content).toBe('{"text":"raw"}');
  });
});

// ---------------------------------------------------------------------------
// extractAndValidate
// ---------------------------------------------------------------------------

describe('StructuredOutputAdapter.extractAndValidate', () => {
  it('returns success for valid JSON matching the schema', () => {
    const schema = z.object({ text: z.string() });
    const meta = {
      config: makeConfig({ schema }),
      mode: 'provider_native' as const,
      jsonSchema: {},
    };
    const response: ProviderResponse = { content: '{"text":"hello"}' };

    const result = adapter.extractAndValidate(response, meta);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.data).toEqual({ text: 'hello' });
      expect(result.usedMode).toBe('provider_native');
    }
  });

  it('returns failure for invalid JSON', () => {
    const schema = z.object({ text: z.string() });
    const meta = {
      config: makeConfig({ schema }),
      mode: 'prompt_based' as const,
      jsonSchema: {},
    };
    const response: ProviderResponse = { content: 'not json' };

    const result = adapter.extractAndValidate(response, meta);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.usedMode).toBe('prompt_based');
    }
  });

  it('uses prompt_based as default mode when meta is null', () => {
    const response: ProviderResponse = { content: 'anything' };

    const result = adapter.extractAndValidate(response, null);

    expect(result.usedMode).toBe('prompt_based');
  });

  it('returns failure for schema mismatch', () => {
    const schema = z.object({ count: z.number() });
    const meta = {
      config: makeConfig({ schema }),
      mode: 'provider_native' as const,
      jsonSchema: {},
    };
    const response: ProviderResponse = { content: '{"count":"not_a_number"}' };

    const result = adapter.extractAndValidate(response, meta);

    expect(result.success).toBe(false);
  });
});
