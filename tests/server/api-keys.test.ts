import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApiKeyManager } from '../../src/server/api-keys.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ApiKeyManager', () => {
  let tempDir: string;
  let manager: ApiKeyManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'apikey-test-'));
    manager = new ApiKeyManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create and validate a key', () => {
    const raw = manager.create('test', ['read', 'write']);
    expect(raw).toBeTruthy();
    expect(raw.startsWith('xai_')).toBe(true);

    const entry = manager.validate(raw);
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe('test');
    expect(entry!.scopes).toEqual(['read', 'write']);
  });

  it('should reject invalid key', () => {
    manager.create('test', ['read']);
    const entry = manager.validate('invalid-key');
    expect(entry).toBeNull();
  });

  it('should revoke a key', () => {
    const raw = manager.create('revoke-me', ['admin']);
    expect(manager.revoke('revoke-me')).toBe(true);

    const entry = manager.validate(raw);
    expect(entry).toBeNull();
  });

  it('should return false for revoking non-existent key', () => {
    expect(manager.revoke('nope')).toBe(false);
  });

  it('should list keys', () => {
    manager.create('key1', ['read']);
    manager.create('key2', ['write']);

    const list = manager.list();
    expect(list).toHaveLength(2);
    expect(list.map((k) => k.name).sort()).toEqual(['key1', 'key2']);
  });

  it('should persist and reload keys', async () => {
    const raw = manager.create('persist', ['read']);
    await manager.save();

    const manager2 = new ApiKeyManager(tempDir);
    await manager2.load();

    const entry = manager2.validate(raw);
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe('persist');
  });
});
