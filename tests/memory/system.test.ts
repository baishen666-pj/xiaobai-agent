import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemorySystem } from '../../src/memory/system.js';

describe('MemorySystem', () => {
  let testDir: string;
  let memory: MemorySystem;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaobai-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    memory = new MemorySystem(testDir, 100, 50);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should add entries to memory', () => {
    const result = memory.add('memory', 'User prefers dark mode');
    expect(result.success).toBe(true);
    expect(memory.list('memory')).toContain('User prefers dark mode');
  });

  it('should reject duplicate entries', () => {
    memory.add('memory', 'Test entry');
    const result = memory.add('memory', 'Test entry');
    expect(result.success).toBe(true);
    expect(memory.list('memory').length).toBe(1);
  });

  it('should respect character limits', () => {
    const result = memory.add('memory', 'x'.repeat(101));
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds limit');
  });

  it('should replace entries by substring', () => {
    memory.add('memory', 'User prefers dark mode');
    const result = memory.replace('memory', 'dark mode', 'User prefers light mode in VS Code');
    expect(result.success).toBe(true);
    expect(memory.list('memory')).toContain('User prefers light mode in VS Code');
    expect(memory.list('memory')).not.toContain('User prefers dark mode');
  });

  it('should remove entries by substring', () => {
    memory.add('memory', 'Entry to remove');
    const result = memory.remove('memory', 'Entry to remove');
    expect(result.success).toBe(true);
    expect(memory.list('memory')).not.toContain('Entry to remove');
  });

  it('should report usage stats', () => {
    memory.add('memory', 'Test');
    memory.add('user', 'User info');
    const usage = memory.getUsage();
    expect(usage.memory.used).toBe(4);
    expect(usage.memory.limit).toBe(100);
    expect(usage.user.used).toBe(9);
    expect(usage.user.limit).toBe(50);
  });

  it('should generate system prompt block', async () => {
    memory.add('memory', 'Project uses TypeScript');
    memory.add('user', 'Senior developer');
    const block = await memory.getSystemPromptBlock();
    expect(block).toContain('MEMORY');
    expect(block).toContain('USER PROFILE');
    expect(block).toContain('Project uses TypeScript');
  });
});
