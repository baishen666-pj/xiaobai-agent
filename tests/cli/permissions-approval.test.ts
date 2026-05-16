import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionPrompt } from '../../src/cli/permissions.js';
import type { Interface } from 'node:readline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockReadline(answers: string[]): Interface {
  let callIndex = 0;
  return {
    question: vi.fn((_prompt: string, cb: (ans: string) => void) => {
      const answer = answers[callIndex] ?? '';
      callIndex++;
      cb(answer);
    }),
    close: vi.fn(),
  } as unknown as Interface;
}

function createSequentialMockReadline(answers: string[]): Interface {
  let callIndex = 0;
  return {
    question: vi.fn((_prompt: string, cb: (ans: string) => void) => {
      const answer = answers[callIndex] ?? '';
      callIndex++;
      cb(answer);
    }),
    close: vi.fn(),
  } as unknown as Interface;
}

// ---------------------------------------------------------------------------
// Trusted tool type
// ---------------------------------------------------------------------------
describe('PermissionPrompt — trusted tool types', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('trusts a tool type via addTrustedToolType', () => {
    const prompt = new PermissionPrompt('default');
    prompt.addTrustedToolType('write');
    expect(prompt.isToolTypeTrusted('write')).toBe(true);
  });

  it('does not trust an unregistered tool type', () => {
    const prompt = new PermissionPrompt('default');
    expect(prompt.isToolTypeTrusted('write')).toBe(false);
  });

  it('auto-allows trusted tool type without prompting', async () => {
    const prompt = new PermissionPrompt('default');
    prompt.addTrustedToolType('write');

    const result = await prompt.checkPermission('write', { file_path: '/tmp/test.txt', content: 'hello' });
    expect(result).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('auto-allows trusted edit tool type', async () => {
    const prompt = new PermissionPrompt('default');
    prompt.addTrustedToolType('edit');

    const result = await prompt.checkPermission('edit', {
      file_path: '/tmp/test.txt',
      old_string: 'a',
      new_string: 'b',
    });
    expect(result).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('still prompts for non-trusted tools even when other tools are trusted', async () => {
    const prompt = new PermissionPrompt('default');
    prompt.addTrustedToolType('write');
    const mockRl = createMockReadline(['y']);
    prompt.setReadline(mockRl);

    // bash with dangerous command should still prompt
    const result = await prompt.checkPermission('bash', { command: 'rm -rf /tmp/test' });
    expect(result).toBe(true);
    expect(logSpy).toHaveBeenCalled();
  });

  it('getTrustedToolTypes returns the set of trusted tools', () => {
    const prompt = new PermissionPrompt('default');
    prompt.addTrustedToolType('write');
    prompt.addTrustedToolType('edit');
    const trusted = prompt.getTrustedToolTypes();
    expect(trusted.has('write')).toBe(true);
    expect(trusted.has('edit')).toBe(true);
    expect(trusted.has('bash')).toBe(false);
  });

  it('trusted tools are checked after cached rules but before prompting', async () => {
    const prompt = new PermissionPrompt('default');
    // Add a deny rule for write
    (prompt as any).rules.push({ tool: 'write', decision: 'deny' });

    // Rule cache takes priority over trusted
    prompt.addTrustedToolType('write');
    const result = await prompt.checkPermission('write', { file_path: '/tmp/test.txt' });
    expect(result).toBe(false);
  });

  it('[t] option trusts the tool type for the current session', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createMockReadline(['t']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('write', { file_path: '/tmp/test.txt', content: 'data' });
    expect(result).toBe(true);

    // Verify the tool is now trusted
    expect(prompt.isToolTypeTrusted('write')).toBe(true);

    // Subsequent calls should not prompt
    logSpy.mockClear();
    const result2 = await prompt.checkPermission('write', { file_path: '/tmp/other.txt', content: 'more' });
    expect(result2).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('[trust] full word trusts the tool type', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createMockReadline(['trust']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('edit', {
      file_path: '/tmp/test.txt',
      old_string: 'a',
      new_string: 'b',
    });
    expect(result).toBe(true);
    expect(prompt.isToolTypeTrusted('edit')).toBe(true);
  });

  it('[T] uppercase trusts the tool type', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createMockReadline(['T']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('write', { file_path: '/tmp/test.txt' });
    expect(result).toBe(true);
    expect(prompt.isToolTypeTrusted('write')).toBe(true);
  });

  it('prints trust confirmation message', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createMockReadline(['t']);
    prompt.setReadline(mockRl);

    await prompt.checkPermission('write', { file_path: '/tmp/test.txt' });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('trusted');
  });
});

// ---------------------------------------------------------------------------
// Diff display option
// ---------------------------------------------------------------------------
describe('PermissionPrompt — [d] diff option', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('shows diff for write tool when [d] is selected', async () => {
    const prompt = new PermissionPrompt('default');
    // First answer 'd' to show diff, then 'y' to allow
    const mockRl = createSequentialMockReadline(['d', 'y']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('write', {
      file_path: '/tmp/nonexistent-test-file.txt',
      content: 'hello world',
    });
    expect(result).toBe(true);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    // Should have shown diff output
    expect(allOutput).toContain('new file');
  });

  it('shows diff for edit tool when [d] is selected', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createSequentialMockReadline(['d', 'y']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('edit', {
      file_path: '/tmp/test.txt',
      old_string: 'old code',
      new_string: 'new code',
    });
    expect(result).toBe(true);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('- old code');
    expect(allOutput).toContain('+ new code');
  });

  it('[diff] full word also works', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createSequentialMockReadline(['diff', 'y']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('write', {
      file_path: '/tmp/test.txt',
      content: 'content',
    });
    expect(result).toBe(true);
  });

  it('[d] is not shown for non-write/edit tools', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createSequentialMockReadline(['d', 'y']);
    prompt.setReadline(mockRl);

    // 'd' is not valid for bash (non-diff tool), should be treated as deny
    const result = await prompt.checkPermission('bash', { command: 'rm -rf /tmp/test' });
    // 'd' is unrecognized for bash, falls through to deny
    expect(result).toBe(false);

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).not.toContain('[d] Show diff');
  });

  it('diff option loops back to prompt after showing diff', async () => {
    const prompt = new PermissionPrompt('default');
    // Show diff twice, then allow
    const mockRl = createSequentialMockReadline(['d', 'd', 'y']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('edit', {
      file_path: '/tmp/test.txt',
      old_string: 'a',
      new_string: 'b',
    });
    expect(result).toBe(true);
    // readline should have been called 3 times (d, d, y)
    expect((mockRl.question as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Enhanced prompt options
// ---------------------------------------------------------------------------
describe('PermissionPrompt — enhanced prompt display', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('shows [t] Trust tool type option for all tools', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createMockReadline(['y']);
    prompt.setReadline(mockRl);

    await prompt.checkPermission('bash', { command: 'rm -rf /tmp/test' });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('[t] Trust tool type');
  });

  it('shows [d] Show diff option for write tool', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createMockReadline(['y']);
    prompt.setReadline(mockRl);

    await prompt.checkPermission('write', { file_path: '/tmp/test.txt', content: 'data' });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('[d] Show diff');
  });

  it('shows [d] Show diff option for edit tool', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createMockReadline(['y']);
    prompt.setReadline(mockRl);

    await prompt.checkPermission('edit', { file_path: '/tmp/test.txt', old_string: 'a', new_string: 'b' });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('[d] Show diff');
  });

  it('shows all options in order', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createMockReadline(['y']);
    prompt.setReadline(mockRl);

    await prompt.checkPermission('write', { file_path: '/tmp/test.txt', content: 'x' });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('[y] Allow');
    expect(allOutput).toContain('[n] Deny');
    expect(allOutput).toContain('[a] Always allow');
    expect(allOutput).toContain('[t] Trust tool type');
    expect(allOutput).toContain('[d] Show diff');
  });
});

// ---------------------------------------------------------------------------
// Integration: write/edit with diff preview
// ---------------------------------------------------------------------------
describe('PermissionPrompt — integration with diff preview', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('write tool triggers prompt with diff option', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createSequentialMockReadline(['d', 'y']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('write', {
      file_path: '/tmp/newfile.txt',
      content: 'file content\nline2\nline3',
    });

    expect(result).toBe(true);
    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('new file');
  });

  it('edit tool triggers prompt with diff showing changes', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createSequentialMockReadline(['d', 'a']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('edit', {
      file_path: '/tmp/code.ts',
      old_string: 'function old() {\n  return 1;\n}',
      new_string: 'function new() {\n  return 2;\n}',
    });

    expect(result).toBe(true);
    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(allOutput).toContain('- function old()');
    expect(allOutput).toContain('+ function new()');
  });

  it('user can deny after viewing diff', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createSequentialMockReadline(['d', 'n']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('write', {
      file_path: '/tmp/test.txt',
      content: 'data',
    });

    expect(result).toBe(false);
  });

  it('user can trust after viewing diff', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createSequentialMockReadline(['d', 't']);
    prompt.setReadline(mockRl);

    const result = await prompt.checkPermission('write', {
      file_path: '/tmp/test.txt',
      content: 'data',
    });

    expect(result).toBe(true);
    expect(prompt.isToolTypeTrusted('write')).toBe(true);
  });

  it('always allow after viewing diff still works', async () => {
    const prompt = new PermissionPrompt('default');
    const mockRl = createSequentialMockReadline(['d', 'a']);
    prompt.setReadline(mockRl);

    const result1 = await prompt.checkPermission('write', {
      file_path: '/tmp/test.txt',
      content: 'data',
    });
    expect(result1).toBe(true);

    // Second call should use cached rule
    logSpy.mockClear();
    const result2 = await prompt.checkPermission('write', {
      file_path: '/tmp/other.txt',
      content: 'more data',
    });
    expect(result2).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
