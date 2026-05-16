import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

let testDir: string;

vi.mock('node:os', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:os')>();
  return {
    ...orig,
    homedir: () => testDir,
  };
});

import { ConfigManager } from '../../src/config/manager.js';

describe('ConfigManager', () => {
  let profileDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaobai-cfg-${randomUUID()}`);
    profileDir = join(testDir, '.xiaobai', 'default');
    mkdirSync(profileDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('loads default config when no file exists', () => {
    const cm = new ConfigManager();
    const config = cm.get();
    expect(config.model.default).toBe('claude-sonnet-4-6');
    expect(config.provider.default).toBe('anthropic');
    expect(config.memory.enabled).toBe(true);
    expect(config.sandbox.mode).toBe('workspace-write');
    expect(config.context.compressionThreshold).toBe(0.5);
    expect(config.plugins.enabled).toBe(true);
  });

  it('loads config from YAML file', () => {
    writeFileSync(join(profileDir, 'config.yaml'), [
      'model:',
      '  default: gpt-4o',
      'provider:',
      '  default: openai',
      '  apiKey: test-key',
    ].join('\n'), 'utf-8');

    const cm = new ConfigManager();
    const config = cm.get();
    expect(config.model.default).toBe('gpt-4o');
    expect(config.provider.default).toBe('openai');
    expect(config.provider.apiKey).toBe('test-key');
  });

  it('merges partial YAML config with defaults', () => {
    writeFileSync(join(profileDir, 'config.yaml'), [
      'model:',
      '  default: deepseek-chat',
    ].join('\n'), 'utf-8');

    const cm = new ConfigManager();
    const config = cm.get();
    expect(config.model.default).toBe('deepseek-chat');
    expect(config.model.fallback).toBe('claude-haiku-4-5-20251001'); // preserved default
    expect(config.provider.default).toBe('anthropic'); // preserved default
  });

  it('get() with key returns specific section', () => {
    const cm = new ConfigManager();
    expect(cm.get('model').default).toBe('claude-sonnet-4-6');
    expect(cm.get('provider').default).toBe('anthropic');
    expect(cm.get('sandbox').mode).toBe('workspace-write');
  });

  it('save() writes config to YAML', () => {
    const cm = new ConfigManager();
    cm.save({ model: { default: 'gpt-4o-mini' } });

    const cm2 = new ConfigManager();
    expect(cm2.get('model').default).toBe('gpt-4o-mini');
  });

  it('save() creates config dir if missing', () => {
    rmSync(profileDir, { recursive: true, force: true });
    const cm = new ConfigManager();
    cm.save({ model: { default: 'test-model' } });
    expect(existsSync(join(profileDir, 'config.yaml'))).toBe(true);
  });

  it('getConfigDir() returns config directory', () => {
    const cm = new ConfigManager();
    expect(cm.getConfigDir()).toBe(profileDir);
  });

  it('uses custom profile name', () => {
    const customDir = join(testDir, '.xiaobai', 'custom');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'config.yaml'), [
      'model:',
      '  default: custom-model',
    ].join('\n'), 'utf-8');

    const cm = new ConfigManager('custom');
    expect(cm.get('model').default).toBe('custom-model');
    expect(cm.getConfigDir()).toBe(customDir);
  });

  it('static getDefault() returns fresh default config', () => {
    const config = ConfigManager.getDefault();
    expect(config.model.default).toBe('claude-sonnet-4-6');
    expect(config.provider.default).toBe('anthropic');
  });

  // --- Environment variable overrides ---

  it('XIAOBAI_API_KEY sets provider apiKey', () => {
    vi.stubEnv('XIAOBAI_API_KEY', 'env-test-key');
    const cm = new ConfigManager();
    expect(cm.get('provider').apiKey).toBe('env-test-key');
  });

  it('ANTHROPIC_API_KEY sets provider apiKey', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const cm = new ConfigManager();
    expect(cm.get('provider').apiKey).toBe('anthropic-key');
  });

  it('OPENAI_API_KEY sets provider apiKey', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    const cm = new ConfigManager();
    expect(cm.get('provider').apiKey).toBe('openai-key');
  });

  it('XIAOBAI_PROVIDER overrides provider and sets model', () => {
    vi.stubEnv('XIAOBAI_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY', 'ds-key');
    const cm = new ConfigManager();
    expect(cm.get('provider').default).toBe('deepseek');
    expect(cm.get('provider').apiKey).toBe('ds-key');
    expect(cm.get('model').default).toBe('deepseek-chat');
  });

  it('XIAOBAI_MODEL overrides model default', () => {
    vi.stubEnv('XIAOBAI_MODEL', 'claude-opus-4-7');
    const cm = new ConfigManager();
    expect(cm.get('model').default).toBe('claude-opus-4-7');
  });

  it('XIAOBAI_PROVIDER with XIAOBAI_MODEL uses explicit model', () => {
    vi.stubEnv('XIAOBAI_PROVIDER', 'openai');
    vi.stubEnv('XIAOBAI_MODEL', 'gpt-4o');
    vi.stubEnv('OPENAI_API_KEY', 'oi-key');
    const cm = new ConfigManager();
    expect(cm.get('provider').default).toBe('openai');
    expect(cm.get('model').default).toBe('gpt-4o');
  });

  it('findApiKeyForProvider returns XIAOBAI_API_KEY as fallback', () => {
    vi.stubEnv('XIAOBAI_PROVIDER', 'unknown-provider');
    vi.stubEnv('XIAOBAI_API_KEY', 'fallback-key');
    const cm = new ConfigManager();
    expect(cm.get('provider').apiKey).toBe('fallback-key');
  });

  it('getDefaultModelForProvider returns undefined for unknown provider', () => {
    vi.stubEnv('XIAOBAI_PROVIDER', 'custom-provider');
    const cm = new ConfigManager();
    // model.default stays as default since no model map entry
    expect(cm.get('model').default).toBe('claude-sonnet-4-6');
  });

  it('getDefaultModelForProvider returns correct model for known providers', () => {
    const providers = [
      ['groq', 'llama-3.3-70b-versatile'],
      ['google', 'gemini-2.0-flash'],
      ['qwen', 'qwen-turbo'],
      ['zhipu', 'glm-4-flash'],
    ] as const;

    for (const [provider, expectedModel] of providers) {
      vi.stubEnv('XIAOBAI_PROVIDER', provider);
      const cm = new ConfigManager();
      expect(cm.get('model').default).toBe(expectedModel);
      vi.unstubAllEnvs();
    }
  });

  it('merges nested config correctly', () => {
    writeFileSync(join(profileDir, 'config.yaml'), [
      'memory:',
      '  enabled: false',
      '  memoryCharLimit: 5000',
      'context:',
      '  maxTurns: 50',
    ].join('\n'), 'utf-8');

    const cm = new ConfigManager();
    const config = cm.get();
    expect(config.memory.enabled).toBe(false);
    expect(config.memory.memoryCharLimit).toBe(5000);
    expect(config.memory.userCharLimit).toBe(1375); // default preserved
    expect(config.context.maxTurns).toBe(50);
    expect(config.context.compressionThreshold).toBe(0.5); // default preserved
  });

  it('save() and reload preserves all fields', () => {
    const cm = new ConfigManager();
    cm.save({
      model: { default: 'test-model', fallback: 'fallback-model' },
      sandbox: { mode: 'read-only' },
      permissions: { mode: 'auto', deny: ['bash'], allow: ['read'] },
    });

    const cm2 = new ConfigManager();
    const config = cm2.get();
    expect(config.model.default).toBe('test-model');
    expect(config.model.fallback).toBe('fallback-model');
    expect(config.sandbox.mode).toBe('read-only');
    expect(config.permissions.mode).toBe('auto');
    expect(config.permissions.deny).toContain('bash');
    expect(config.permissions.allow).toContain('read');
  });
});
