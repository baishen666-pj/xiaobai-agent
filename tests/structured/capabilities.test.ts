import { describe, it, expect } from 'vitest';
import { getProviderCapability, resolveStructuredMode } from '../../src/structured/capabilities.js';

// ---------------------------------------------------------------------------
// getProviderCapability
// ---------------------------------------------------------------------------

describe('getProviderCapability', () => {
  it('returns json_schema for openai', () => {
    expect(getProviderCapability('openai')).toBe('json_schema');
  });

  it('returns json_schema for chatgpt-web', () => {
    expect(getProviderCapability('chatgpt-web')).toBe('json_schema');
  });

  it('returns tool_use for anthropic', () => {
    expect(getProviderCapability('anthropic')).toBe('tool_use');
  });

  it('returns tool_use for claude-web', () => {
    expect(getProviderCapability('claude-web')).toBe('tool_use');
  });

  it('returns json_schema for google', () => {
    expect(getProviderCapability('google')).toBe('json_schema');
  });

  it('returns json_object for deepseek', () => {
    expect(getProviderCapability('deepseek')).toBe('json_object');
  });

  it('returns json_object for qwen', () => {
    expect(getProviderCapability('qwen')).toBe('json_object');
  });

  it('returns json_object for zhipu', () => {
    expect(getProviderCapability('zhipu')).toBe('json_object');
  });

  it('returns json_object for moonshot', () => {
    expect(getProviderCapability('moonshot')).toBe('json_object');
  });

  it('returns json_object for yi', () => {
    expect(getProviderCapability('yi')).toBe('json_object');
  });

  it('returns json_object for baidu', () => {
    expect(getProviderCapability('baidu')).toBe('json_object');
  });

  it('returns json_object for minimax', () => {
    expect(getProviderCapability('minimax')).toBe('json_object');
  });

  it('returns json_object for baichuan', () => {
    expect(getProviderCapability('baichuan')).toBe('json_object');
  });

  it('returns json_object for groq', () => {
    expect(getProviderCapability('groq')).toBe('json_object');
  });

  it('returns none for ollama', () => {
    expect(getProviderCapability('ollama')).toBe('none');
  });

  it('returns none for unknown provider', () => {
    expect(getProviderCapability('unknown_provider')).toBe('none');
  });

  it('returns none for empty string', () => {
    expect(getProviderCapability('')).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// resolveStructuredMode
// ---------------------------------------------------------------------------

describe('resolveStructuredMode', () => {
  describe('auto mode', () => {
    it('returns provider_native for openai (json_schema capability)', () => {
      expect(resolveStructuredMode('openai', 'auto')).toBe('provider_native');
    });

    it('returns provider_native for anthropic (tool_use capability)', () => {
      expect(resolveStructuredMode('anthropic', 'auto')).toBe('provider_native');
    });

    it('returns provider_native for deepseek (json_object capability)', () => {
      expect(resolveStructuredMode('deepseek', 'auto')).toBe('provider_native');
    });

    it('returns prompt_based for ollama (none capability)', () => {
      expect(resolveStructuredMode('ollama', 'auto')).toBe('prompt_based');
    });

    it('returns prompt_based for unknown provider', () => {
      expect(resolveStructuredMode('totally_unknown', 'auto')).toBe('prompt_based');
    });
  });

  describe('explicit modes', () => {
    it('returns provider_native when explicitly requested', () => {
      expect(resolveStructuredMode('ollama', 'provider_native')).toBe('provider_native');
    });

    it('returns prompt_based when explicitly requested', () => {
      expect(resolveStructuredMode('openai', 'prompt_based')).toBe('prompt_based');
    });
  });
});
