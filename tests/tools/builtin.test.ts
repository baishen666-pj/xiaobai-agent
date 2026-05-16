import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { getBuiltinTools, _resetRgCache } from '../../src/tools/builtin.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { SecurityManager } from '../../src/security/manager.js';
import { ConfigManager } from '../../src/config/manager.js';
import { MemorySystem } from '../../src/memory/system.js';
import { SandboxManager } from '../../src/sandbox/manager.js';
import type { ToolResult } from '../../src/tools/registry.js';

// We need mutable references for mocking Node builtins. vitest's vi.mock is
// hoisted, but for inline per-test control we store overrides here and use
// vi.mock factories that delegate to them.
let mockExecSyncOverride: ((...args: any[]) => any) | null = null;
let mockExecFileSyncOverride: ((...args: any[]) => any) | null = null;
let mockStatSyncOverride: ((...args: any[]) => any) | null = null;
let mockReadFileSyncOverride: ((...args: any[]) => any) | null = null;
let mockWriteFileSyncOverride: ((...args: any[]) => any) | null = null;
let mockFsPromisesGlobOverride: ((...args: any[]) => any) | null = null;

// Hoisted mock for node:child_process
vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return {
    ...orig,
    execSync: (...args: any[]) => {
      if (mockExecSyncOverride) return mockExecSyncOverride(...args);
      return orig.execSync(...args);
    },
    execFileSync: (...args: any[]) => {
      if (mockExecFileSyncOverride) return mockExecFileSyncOverride(...args);
      return orig.execFileSync(...args);
    },
    // Pass through spawn, etc.
    spawn: orig.spawn,
  };
});

// Hoisted mock for node:fs
vi.mock('node:fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs')>();
  return {
    ...orig,
    statSync: (...args: any[]) => {
      if (mockStatSyncOverride) return mockStatSyncOverride(...args);
      return orig.statSync(...args);
    },
    readFileSync: (...args: any[]) => {
      if (mockReadFileSyncOverride) return mockReadFileSyncOverride(...args);
      return orig.readFileSync(...args);
    },
    writeFileSync: (...args: any[]) => {
      if (mockWriteFileSyncOverride) return mockWriteFileSyncOverride(...args);
      return orig.writeFileSync(...args);
    },
    existsSync: orig.existsSync,
    mkdirSync: orig.mkdirSync,
    readdirSync: orig.readdirSync,
  };
});

// Hoisted mock for node:fs/promises
vi.mock('node:fs/promises', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...orig,
    glob: (...args: any[]) => {
      if (mockFsPromisesGlobOverride) return mockFsPromisesGlobOverride(...args);
      return orig.glob(...args);
    },
    readFile: orig.readFile,
    writeFile: orig.writeFile,
    mkdir: orig.mkdir,
    stat: orig.stat,
    readdir: orig.readdir,
  };
});

let testDir: string;
let sandbox: SandboxManager;

function makeContext(mode: 'read-only' | 'workspace-write' | 'full-access' = 'full-access') {
  const config = ConfigManager.getDefault();
  config.sandbox.mode = mode;
  const security = new SecurityManager(config);
  const memDir = join(testDir, '.mem');
  if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
  const memory = new MemorySystem(memDir);
  sandbox = new SandboxManager(config.sandbox);
  return { security, config, memory, sandbox };
}

beforeEach(() => {
  testDir = join(tmpdir(), `xiaobai-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  // Reset all mock overrides before each test
  mockExecSyncOverride = null;
  mockExecFileSyncOverride = null;
  mockStatSyncOverride = null;
  mockReadFileSyncOverride = null;
  mockWriteFileSyncOverride = null;
  mockFsPromisesGlobOverride = null;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  mockExecSyncOverride = null;
  mockExecFileSyncOverride = null;
  mockStatSyncOverride = null;
  mockReadFileSyncOverride = null;
  mockWriteFileSyncOverride = null;
  mockFsPromisesGlobOverride = null;
});

// ---------------------------------------------------------------------------
// truncate function
// ---------------------------------------------------------------------------

describe('truncate function', () => {
  it('returns short text unchanged', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({ command: 'echo short' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('short');
  });

  it('truncates output exceeding MAX_OUTPUT (50_000 chars)', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    // Create a temp script that outputs 60_000 chars to avoid quoting issues on Windows
    const scriptPath = join(testDir, 'big-output.js');
    writeFileSync(scriptPath, "process.stdout.write('a'.repeat(60000));");
    const result = await bash.execute({
      command: `node ${scriptPath}`,
      timeout: 10000,
    });
    expect(result.success).toBe(true);
    expect(result.output.length).toBeLessThan(60000);
    expect(result.output).toContain('[truncated');
  });
});

// ---------------------------------------------------------------------------
// isPathSafe (indirect via tool error paths)
// ---------------------------------------------------------------------------

describe('isPathSafe (indirect)', () => {
  it('rejects sensitive Windows system paths', async () => {
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const system32 = process.env.SYSTEMROOT
      ? join(process.env.SYSTEMROOT, 'System32', 'drivers', 'etc', 'hosts')
      : 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    const result = await read.execute({ file_path: system32 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('path_unsafe');
  });

  it('rejects relative paths for read', async () => {
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: 'relative/path.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_path');
  });

  it('rejects relative paths for write', async () => {
    const tools = getBuiltinTools(makeContext());
    const write = tools.find((t) => t.definition.name === 'write')!;
    const result = await write.execute({ file_path: 'relative/path.txt', content: 'data' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_path');
  });

  it('rejects relative paths for edit', async () => {
    const tools = getBuiltinTools(makeContext());
    const edit = tools.find((t) => t.definition.name === 'edit')!;
    const result = await edit.execute({
      file_path: 'relative/path.txt',
      old_string: 'a',
      new_string: 'b',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_path');
  });

  it('allows paths within allowedDirs', async () => {
    const tools = getBuiltinTools(makeContext());
    const filePath = join(testDir, 'safe.txt');
    writeFileSync(filePath, 'content');
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: filePath });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isBinaryContent (indirect via read tool)
// ---------------------------------------------------------------------------

describe('isBinaryContent (indirect via read tool)', () => {
  it('detects binary content with null bytes', async () => {
    const filePath = join(testDir, 'binary.bin');
    const buf = Buffer.alloc(100, 0);
    writeFileSync(filePath, buf);
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: filePath });
    expect(result.success).toBe(true);
    expect(result.metadata?.binary).toBe(true);
  });

  it('allows normal text content', async () => {
    const filePath = join(testDir, 'text.txt');
    writeFileSync(filePath, 'Hello, world!');
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: filePath });
    expect(result.success).toBe(true);
    expect(result.metadata?.binary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bash Tool
// ---------------------------------------------------------------------------

describe('Bash Tool', () => {
  it('executes echo command', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({ command: 'echo hello world' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('captures stderr on non-zero exit', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({
      command: 'node -e "process.stderr.write(\'err-output\'); process.stderr.end()"',
      timeout: 5000,
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain('err-output');
  });

  it('returns failure on non-zero exit', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({ command: 'exit 1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('execution_failed');
  });

  it('respects timeout', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({
      command: 'node -e "setTimeout(() => {}, 10000)"',
      timeout: 500,
    });
    expect(result.success).toBe(false);
  }, 10000);

  it('blocks dangerous commands in sandbox', async () => {
    const ctx = makeContext('workspace-write');
    const tools = getBuiltinTools(ctx);
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({
      command: 'rm -rf /something/dangerous',
      cwd: testDir,
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain('blocked by sandbox');
  });

  it('uses cwd parameter when provided', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({ command: 'cd', cwd: testDir });
    expect(result.success).toBe(true);
    const expected = testDir.replace(/\//g, '\\');
    expect(result.output).toContain(expected);
  });

  it('defaults cwd to process.cwd() when not provided', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({ command: 'cd' });
    expect(result.success).toBe(true);
  });

  it('handles spawn errors gracefully', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({
      command: 'this_command_does_not_exist_xyz123',
      timeout: 5000,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('execution_failed');
  });
});

// ---------------------------------------------------------------------------
// Read Tool
// ---------------------------------------------------------------------------

describe('Read Tool', () => {
  it('reads a file with line numbers', async () => {
    const filePath = join(testDir, 'test.txt');
    writeFileSync(filePath, 'line1\nline2\nline3');
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: filePath });
    expect(result.success).toBe(true);
    expect(result.output).toContain('1\tline1');
    expect(result.output).toContain('2\tline2');
  });

  it('returns error for missing file', async () => {
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: '/nonexistent/file.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('file_not_found');
  });

  it('respects offset and limit', async () => {
    const filePath = join(testDir, 'lines.txt');
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    writeFileSync(filePath, lines.join('\n'));
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: filePath, offset: 5, limit: 3 });
    expect(result.success).toBe(true);
    expect(result.output).toContain('6\tline6');
    expect(result.output).toContain('8\tline8');
    expect(result.output).not.toContain('line5');
  });

  it('rejects relative paths', async () => {
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: 'relative/path.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_path');
  });

  it('detects binary files', async () => {
    const filePath = join(testDir, 'binary.bin');
    const buf = Buffer.alloc(100, 0);
    writeFileSync(filePath, buf);
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: filePath });
    expect(result.success).toBe(true);
    expect(result.metadata?.binary).toBe(true);
  });

  it('lists directory contents', async () => {
    mkdirSync(join(testDir, 'dir'));
    writeFileSync(join(testDir, 'dir', 'a.txt'), 'a');
    writeFileSync(join(testDir, 'dir', 'b.txt'), 'b');
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: join(testDir, 'dir') });
    expect(result.success).toBe(true);
    expect(result.output).toContain('a.txt');
    expect(result.output).toContain('b.txt');
  });

  it('rejects files larger than 10MB', async () => {
    const filePath = join(testDir, 'big.txt');
    writeFileSync(filePath, 'small');

    const origFs = await import('node:fs');
    mockStatSyncOverride = (p: string) => {
      if (typeof p === 'string' && p.includes('big.txt')) {
        return {
          size: 20 * 1024 * 1024,
          isDirectory: () => false,
          isFile: () => true,
        } as any;
      }
      return origFs.statSync(p);
    };

    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const result = await read.execute({ file_path: filePath });
    expect(result.success).toBe(false);
    expect(result.error).toBe('file_too_large');
    expect(result.output).toContain('File too large');
  });

  it('handles read failure gracefully', async () => {
    const tools = getBuiltinTools(makeContext());
    const read = tools.find((t) => t.definition.name === 'read')!;
    const filePath = join(testDir, 'readfail.txt');
    writeFileSync(filePath, 'content');

    mockReadFileSyncOverride = (...args: any[]) => {
      if (typeof args[0] === 'string' && args[0].includes('readfail.txt')) {
        throw new Error('permission denied');
      }
      return readFileSync(args[0], args[1]);
    };

    const result = await read.execute({ file_path: filePath });
    expect(result.success).toBe(false);
    expect(result.error).toBe('read_error');
    expect(result.output).toContain('Read failed');
  });
});

// ---------------------------------------------------------------------------
// Write Tool
// ---------------------------------------------------------------------------

describe('Write Tool', () => {
  it('writes content to a new file', async () => {
    const filePath = join(testDir, 'new.txt');
    const tools = getBuiltinTools(makeContext());
    const write = tools.find((t) => t.definition.name === 'write')!;
    const result = await write.execute({ file_path: filePath, content: 'hello' });
    expect(result.success).toBe(true);
    expect(result.metadata?.size).toBe(5);
  });

  it('creates parent directories', async () => {
    const filePath = join(testDir, 'deep', 'nested', 'file.txt');
    const tools = getBuiltinTools(makeContext());
    const write = tools.find((t) => t.definition.name === 'write')!;
    const result = await write.execute({ file_path: filePath, content: 'nested' });
    expect(result.success).toBe(true);
    expect(existsSync(filePath)).toBe(true);
  });

  it('rejects write in read-only sandbox', async () => {
    const filePath = join(testDir, 'blocked.txt');
    const ctx = makeContext('read-only');
    const tools = getBuiltinTools(ctx);
    const write = tools.find((t) => t.definition.name === 'write')!;
    const result = await write.execute({ file_path: filePath, content: 'blocked' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('sandbox_denied');
  });

  it('rejects relative paths', async () => {
    const tools = getBuiltinTools(makeContext());
    const write = tools.find((t) => t.definition.name === 'write')!;
    const result = await write.execute({ file_path: 'relative.txt', content: 'data' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_path');
  });

  it('rejects unsafe paths', async () => {
    const tools = getBuiltinTools(makeContext());
    const write = tools.find((t) => t.definition.name === 'write')!;
    const system32 = process.env.SYSTEMROOT
      ? join(process.env.SYSTEMROOT, 'System32', 'test.txt')
      : 'C:\\Windows\\System32\\test.txt';
    const result = await write.execute({ file_path: system32, content: 'malicious' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('path_unsafe');
  });

  it('handles write failure gracefully', async () => {
    const tools = getBuiltinTools(makeContext());
    const write = tools.find((t) => t.definition.name === 'write')!;
    const filePath = join(testDir, 'writefail.txt');

    mockWriteFileSyncOverride = () => {
      throw new Error('disk full');
    };

    const result = await write.execute({ file_path: filePath, content: 'data' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('write_error');
    expect(result.output).toContain('Write failed');
  });
});

// ---------------------------------------------------------------------------
// Edit Tool
// ---------------------------------------------------------------------------

describe('Edit Tool', () => {
  it('replaces a unique string', async () => {
    const filePath = join(testDir, 'edit.txt');
    writeFileSync(filePath, 'foo bar baz');
    const tools = getBuiltinTools(makeContext());
    const edit = tools.find((t) => t.definition.name === 'edit')!;
    const result = await edit.execute({
      file_path: filePath,
      old_string: 'bar',
      new_string: 'BAR',
    });
    expect(result.success).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('foo BAR baz');
  });

  it('rejects ambiguous match', async () => {
    const filePath = join(testDir, 'dup.txt');
    writeFileSync(filePath, 'abc abc abc');
    const tools = getBuiltinTools(makeContext());
    const edit = tools.find((t) => t.definition.name === 'edit')!;
    const result = await edit.execute({
      file_path: filePath,
      old_string: 'abc',
      new_string: 'xyz',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('ambiguous_match');
  });

  it('replaces all with replace_all flag', async () => {
    const filePath = join(testDir, 'all.txt');
    writeFileSync(filePath, 'aaa bbb aaa');
    const tools = getBuiltinTools(makeContext());
    const edit = tools.find((t) => t.definition.name === 'edit')!;
    const result = await edit.execute({
      file_path: filePath,
      old_string: 'aaa',
      new_string: 'ccc',
      replace_all: true,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('2 replacement');
    expect(readFileSync(filePath, 'utf-8')).toBe('ccc bbb ccc');
  });

  it('rejects edit in read-only sandbox', async () => {
    const filePath = join(testDir, 'sandbox-edit.txt');
    writeFileSync(filePath, 'original');
    const ctx = makeContext('read-only');
    const tools = getBuiltinTools(ctx);
    const edit = tools.find((t) => t.definition.name === 'edit')!;
    const result = await edit.execute({
      file_path: filePath,
      old_string: 'original',
      new_string: 'modified',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('sandbox_denied');
  });

  it('rejects relative paths', async () => {
    const tools = getBuiltinTools(makeContext());
    const edit = tools.find((t) => t.definition.name === 'edit')!;
    const result = await edit.execute({
      file_path: 'relative.txt',
      old_string: 'a',
      new_string: 'b',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_path');
  });

  it('rejects unsafe paths', async () => {
    const tools = getBuiltinTools(makeContext());
    const edit = tools.find((t) => t.definition.name === 'edit')!;
    const system32 = process.env.SYSTEMROOT
      ? join(process.env.SYSTEMROOT, 'System32', 'test.txt')
      : 'C:\\Windows\\System32\\test.txt';
    const result = await edit.execute({
      file_path: system32,
      old_string: 'a',
      new_string: 'b',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('path_unsafe');
  });

  it('returns error when file not found', async () => {
    const tools = getBuiltinTools(makeContext());
    const edit = tools.find((t) => t.definition.name === 'edit')!;
    const result = await edit.execute({
      file_path: join(testDir, 'nonexistent.txt'),
      old_string: 'a',
      new_string: 'b',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('file_not_found');
  });

  it('returns error when old_string not found', async () => {
    const filePath = join(testDir, 'nomatch.txt');
    writeFileSync(filePath, 'hello world');
    const tools = getBuiltinTools(makeContext());
    const edit = tools.find((t) => t.definition.name === 'edit')!;
    const result = await edit.execute({
      file_path: filePath,
      old_string: 'not_in_file',
      new_string: 'replacement',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('match_not_found');
  });

  it('handles edit failure gracefully', async () => {
    const filePath = join(testDir, 'editfail.txt');
    writeFileSync(filePath, 'foo bar');
    const tools = getBuiltinTools(makeContext());
    const edit = tools.find((t) => t.definition.name === 'edit')!;

    mockWriteFileSyncOverride = () => {
      throw new Error('write failed');
    };

    const result = await edit.execute({
      file_path: filePath,
      old_string: 'foo',
      new_string: 'baz',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('edit_error');
    expect(result.output).toContain('Edit failed');
  });
});

// ---------------------------------------------------------------------------
// Grep Tool
// ---------------------------------------------------------------------------

describe('Grep Tool', () => {
  beforeEach(() => {
    mkdirSync(join(testDir, 'src'), { recursive: true });
    writeFileSync(join(testDir, 'src', 'a.ts'), 'function hello() {\n  return "world";\n}');
    writeFileSync(join(testDir, 'src', 'b.ts'), 'function goodbye() {\n  return "farewell";\n}');
    writeFileSync(join(testDir, 'src', 'c.js'), 'const x = "hello";\nconsole.log(x);');
  });

  it('finds files matching pattern', async () => {
    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: 'hello', path: join(testDir, 'src') });
    expect(result.success).toBe(true);
    expect(result.output).toContain('a.ts');
  });

  it('returns content with line numbers', async () => {
    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({
      pattern: 'function',
      path: join(testDir, 'src'),
      output_mode: 'content',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('function hello');
    expect(result.output).toContain('function goodbye');
  });

  it('filters by glob pattern', async () => {
    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({
      pattern: 'hello',
      path: join(testDir, 'src'),
      glob: '*.ts',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('a.ts');
    expect(result.output).not.toContain('c.js');
  });

  it('handles invalid regex gracefully', async () => {
    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: '[invalid', path: testDir });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_regex');
  });

  it('counts matches', async () => {
    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({
      pattern: 'function',
      path: join(testDir, 'src'),
      output_mode: 'count',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain(':');
  });

  it('returns error for non-existent path', async () => {
    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: 'test', path: '/nonexistent/path' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('path_not_found');
  });

  it('returns "No matches found" when nothing matches', async () => {
    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({
      pattern: 'zzz_nonexistent_pattern',
      path: join(testDir, 'src'),
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('No matches found');
  });

  // --- Native fallback tests: make execSync throw so isRgAvailable returns false ---

  it('uses native fallback when ripgrep is unavailable', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => { throw new Error('not found'); };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: 'hello', path: join(testDir, 'src') });
    expect(result.success).toBe(true);
    expect(result.output).toContain('a.ts');
  });

  it('native fallback returns content mode', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => { throw new Error('not found'); };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({
      pattern: 'function',
      path: join(testDir, 'src'),
      output_mode: 'content',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('function hello');
  });

  it('native fallback returns count mode', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => { throw new Error('not found'); };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({
      pattern: 'function',
      path: join(testDir, 'src'),
      output_mode: 'count',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain(':');
  });

  it('native fallback handles single file in content mode', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => { throw new Error('not found'); };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const singleFile = join(testDir, 'src', 'a.ts');
    const result = await grep.execute({
      pattern: 'hello',
      path: singleFile,
      output_mode: 'content',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('native fallback single file returns files mode', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => { throw new Error('not found'); };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const singleFile = join(testDir, 'src', 'a.ts');
    const result = await grep.execute({
      pattern: 'hello',
      path: singleFile,
      output_mode: 'files',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('a.ts');
  });

  it('native fallback single file returns count mode', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => { throw new Error('not found'); };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const singleFile = join(testDir, 'src', 'a.ts');
    const result = await grep.execute({
      pattern: 'hello',
      path: singleFile,
      output_mode: 'count',
    });
    expect(result.success).toBe(true);
    // Both ripgrep and native grep return count info (filepath:count or just a number)
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('native fallback single file no match returns empty', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => { throw new Error('not found'); };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const singleFile = join(testDir, 'src', 'a.ts');
    const result = await grep.execute({
      pattern: 'zzz_no_match',
      path: singleFile,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('No matches found');
  });

  it('native fallback skips binary files', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => { throw new Error('not found'); };

    const binFile = join(testDir, 'src', 'data.bin');
    writeFileSync(binFile, Buffer.alloc(100, 0));

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({
      pattern: 'function',
      path: join(testDir, 'src'),
      output_mode: 'files',
    });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('data.bin');
  });

  // --- ripgrep-specific tests: execSync succeeds (rg found), execFileSync returns results ---

  it('handles ripgrep exit code 2 as regex error', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => Buffer.from('rg found');
    mockExecFileSyncOverride = () => {
      const err: any = new Error('ripgrep error');
      err.status = 2;
      err.stderr = 'regex parse error';
      throw err;
    };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: '[bad', path: join(testDir, 'src') });
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_regex');
  });

  it('handles ripgrep exit code 1 with stdout', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => Buffer.from('rg found');
    mockExecFileSyncOverride = () => {
      const err: any = new Error('exit 1');
      err.status = 1;
      err.stdout = 'result.ts\nother.ts\n';
      throw err;
    };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: 'test', path: join(testDir, 'src') });
    expect(result.success).toBe(true);
    expect(result.output).toContain('result.ts');
  });

  it('handles ripgrep exit code 1 without stdout', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => Buffer.from('rg found');
    mockExecFileSyncOverride = () => {
      const err: any = new Error('exit 1');
      err.status = 1;
      throw err;
    };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: 'nothing_matches_zzz', path: join(testDir, 'src') });
    expect(result.success).toBe(true);
    expect(result.output).toContain('No matches found');
  });

  it('handles ripgrep unexpected throw', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => Buffer.from('rg found');
    mockExecFileSyncOverride = () => {
      throw new Error('unexpected error');
    };

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: 'test', path: join(testDir, 'src') });
    expect(result.success).toBe(false);
    expect(result.error).toBe('grep_error');
  });

  it('handles ripgrep success', async () => {
    _resetRgCache();
    mockExecSyncOverride = () => Buffer.from('rg found');
    mockExecFileSyncOverride = () => 'found.ts\nother.ts\n';

    const tools = getBuiltinTools(makeContext());
    const grep = tools.find((t) => t.definition.name === 'grep')!;
    const result = await grep.execute({ pattern: 'test', path: join(testDir, 'src') });
    expect(result.success).toBe(true);
    expect(result.output).toContain('found.ts');
  });
});

// ---------------------------------------------------------------------------
// Glob Tool
// ---------------------------------------------------------------------------

describe('Glob Tool', () => {
  beforeEach(() => {
    mkdirSync(join(testDir, 'src', 'lib'), { recursive: true });
    writeFileSync(join(testDir, 'src', 'a.ts'), '');
    writeFileSync(join(testDir, 'src', 'b.ts'), '');
    writeFileSync(join(testDir, 'src', 'lib', 'c.ts'), '');
    writeFileSync(join(testDir, 'src', 'd.js'), '');
  });

  it('finds files by pattern', async () => {
    const tools = getBuiltinTools(makeContext());
    const glob = tools.find((t) => t.definition.name === 'glob')!;
    const result = await glob.execute({ pattern: '**/*.ts', path: join(testDir, 'src') });
    expect(result.success).toBe(true);
    expect(result.metadata?.count).toBe(3);
  });

  it('returns no files for non-matching pattern', async () => {
    const tools = getBuiltinTools(makeContext());
    const glob = tools.find((t) => t.definition.name === 'glob')!;
    const result = await glob.execute({ pattern: '**/*.py', path: testDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain('No files found');
  });

  it('handles non-existent path', async () => {
    const tools = getBuiltinTools(makeContext());
    const glob = tools.find((t) => t.definition.name === 'glob')!;
    const result = await glob.execute({ pattern: '*.ts', path: '/nonexistent/path' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('path_not_found');
  });

  it('uses fallback readdir when asyncGlob throws', async () => {
    mockFsPromisesGlobOverride = () => { throw new Error('glob not available'); };

    const tools = getBuiltinTools(makeContext());
    const glob = tools.find((t) => t.definition.name === 'glob')!;
    const result = await glob.execute({ pattern: '**/*.ts', path: join(testDir, 'src') });
    expect(result.success).toBe(true);
    // Fallback readdir should still find .ts files
    expect(result.output).toContain('.ts');
  });
});

// ---------------------------------------------------------------------------
// Memory Tool
// ---------------------------------------------------------------------------

describe('Memory Tool', () => {
  it('adds and lists memory entries', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    const addResult = await mem.execute({ action: 'add', target: 'memory', content: 'test memory entry' });
    expect(addResult.success).toBe(true);

    const listResult = await mem.execute({ action: 'list', target: 'memory' });
    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain('test memory entry');
  });

  it('replaces memory entries', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    await mem.execute({ action: 'add', target: 'user', content: 'old user info' });
    const replaceResult = await mem.execute({
      action: 'replace',
      target: 'user',
      old_text: 'old',
      content: 'new user info',
    });
    expect(replaceResult.success).toBe(true);

    const listResult = await mem.execute({ action: 'list', target: 'user' });
    expect(listResult.output).toContain('new user info');
    expect(listResult.output).not.toContain('old user info');
  });

  it('removes memory entries', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    await mem.execute({ action: 'add', target: 'memory', content: 'to remove' });
    const removeResult = await mem.execute({ action: 'remove', target: 'memory', old_text: 'to remove' });
    expect(removeResult.success).toBe(true);

    const listResult = await mem.execute({ action: 'list', target: 'memory' });
    expect(listResult.output).toContain('empty');
  });

  it('returns error when content missing for add', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    const result = await mem.execute({ action: 'add', target: 'memory' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_content');
  });

  it('returns error when memory context not available', async () => {
    const tools = getBuiltinTools({} as any);
    const mem = tools.find((t) => t.definition.name === 'memory')!;
    const result = await mem.execute({ action: 'list', target: 'memory' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('no_memory');
    expect(result.output).toContain('Memory system not available');
  });

  it('returns error when old_text missing for replace', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    const result = await mem.execute({ action: 'replace', target: 'memory', content: 'new' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_params');
  });

  it('returns error when content missing for replace', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    const result = await mem.execute({ action: 'replace', target: 'memory', old_text: 'old' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_params');
  });

  it('returns error when old_text missing for remove', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    const result = await mem.execute({ action: 'remove', target: 'memory' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_params');
  });

  it('returns failure message when add fails', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    const longContent = 'x'.repeat(2000);
    await mem.execute({ action: 'add', target: 'memory', content: longContent });
    const result = await mem.execute({ action: 'add', target: 'memory', content: longContent });
    if (!result.success) {
      expect(result.output).toContain('Failed');
    }
  });

  it('returns failure message when replace fails (no match)', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    const result = await mem.execute({
      action: 'replace',
      target: 'memory',
      old_text: 'nonexistent_text',
      content: 'new content',
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Failed');
  });

  it('returns failure message when remove fails (no match)', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    const result = await mem.execute({
      action: 'remove',
      target: 'memory',
      old_text: 'nonexistent_text',
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Failed');
  });

  it('lists empty memory store', async () => {
    const ctx = makeContext();
    const tools = getBuiltinTools(ctx);
    const mem = tools.find((t) => t.definition.name === 'memory')!;

    const result = await mem.execute({ action: 'list', target: 'memory' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('empty');
  });
});

// ---------------------------------------------------------------------------
// Agent Tool
// ---------------------------------------------------------------------------

describe('Agent Tool', () => {
  it('has correct definition with prompt required', () => {
    const tools = getBuiltinTools(makeContext());
    const agent = tools.find((t) => t.definition.name === 'agent')!;
    expect(agent.definition.name).toBe('agent');
    expect(agent.definition.parameters.required).toContain('prompt');
  });

  it('has correct definition for agent types', () => {
    const tools = getBuiltinTools(makeContext());
    const agent = tools.find((t) => t.definition.name === 'agent')!;
    expect(agent.definition.parameters.properties.type).toBeDefined();
    const typeProp = agent.definition.parameters.properties.type as { enum: string[] };
    expect(typeProp.enum).toContain('explore');
    expect(typeProp.enum).toContain('plan');
    expect(typeProp.enum).toContain('general-purpose');
  });

  it('spawns a sub-agent and returns success result', async () => {
    const mockSpawn = vi.fn().mockResolvedValue({
      success: true,
      output: 'agent completed task',
      tokensUsed: 100,
      toolCalls: 2,
    });
    const mockDestroy = vi.fn();
    const MockSubAgentEngine = vi.fn().mockReturnValue({
      spawn: mockSpawn,
      destroy: mockDestroy,
    });

    vi.doMock('../../src/core/sub-agent.js', () => ({
      SubAgentEngine: MockSubAgentEngine,
    }));
    vi.doMock('../../src/tools/registry.js', () => ({
      ToolRegistry: vi.fn().mockImplementation(() => ({ register: vi.fn() })),
    }));

    const { getBuiltinTools: getToolsFresh } = await import('../../src/tools/builtin.js');
    const tools = getToolsFresh(makeContext());
    const agent = tools.find((t) => t.definition.name === 'agent')!;
    const result = await agent.execute({ prompt: 'analyze this code' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('agent completed task');
    expect(result.metadata?.tokensUsed).toBe(100);
    expect(result.metadata?.toolCalls).toBe(2);
    expect(mockDestroy).toHaveBeenCalled();

    vi.doUnmock('../../src/core/sub-agent.js');
    vi.doUnmock('../../src/tools/registry.js');
  });

  it('handles sub-agent failure', async () => {
    const mockSpawn = vi.fn().mockResolvedValue({
      success: false,
      output: '',
      error: 'timeout exceeded',
      tokensUsed: 50,
      toolCalls: 0,
    });
    const mockDestroy = vi.fn();
    const MockSubAgentEngine = vi.fn().mockReturnValue({
      spawn: mockSpawn,
      destroy: mockDestroy,
    });

    vi.doMock('../../src/core/sub-agent.js', () => ({
      SubAgentEngine: MockSubAgentEngine,
    }));
    vi.doMock('../../src/tools/registry.js', () => ({
      ToolRegistry: vi.fn().mockImplementation(() => ({ register: vi.fn() })),
    }));

    const { getBuiltinTools: getToolsFresh } = await import('../../src/tools/builtin.js');
    const tools = getToolsFresh(makeContext());
    const agent = tools.find((t) => t.definition.name === 'agent')!;
    const result = await agent.execute({ prompt: 'do something impossible' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Sub-agent failed');
    expect(result.output).toContain('timeout exceeded');
    expect(result.metadata?.tokensUsed).toBe(50);
    expect(mockDestroy).toHaveBeenCalled();

    vi.doUnmock('../../src/core/sub-agent.js');
    vi.doUnmock('../../src/tools/registry.js');
  });

  it('passes explore type to sub-engine', async () => {
    const mockSpawn = vi.fn().mockResolvedValue({
      success: true,
      output: 'explored',
      tokensUsed: 10,
      toolCalls: 0,
    });
    const mockDestroy = vi.fn();
    const MockSubAgentEngine = vi.fn().mockReturnValue({
      spawn: mockSpawn,
      destroy: mockDestroy,
    });

    vi.doMock('../../src/core/sub-agent.js', () => ({
      SubAgentEngine: MockSubAgentEngine,
    }));
    vi.doMock('../../src/tools/registry.js', () => ({
      ToolRegistry: vi.fn().mockImplementation(() => ({ register: vi.fn() })),
    }));

    const { getBuiltinTools: getToolsFresh } = await import('../../src/tools/builtin.js');
    const tools = getToolsFresh(makeContext());
    const agent = tools.find((t) => t.definition.name === 'agent')!;
    const result = await agent.execute({ prompt: 'explore codebase', type: 'explore' });

    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      'explore codebase',
      expect.anything(),
      expect.objectContaining({ definitionName: 'explore' }),
    );

    vi.doUnmock('../../src/core/sub-agent.js');
    vi.doUnmock('../../src/tools/registry.js');
  });

  it('passes plan type to sub-engine', async () => {
    const mockSpawn = vi.fn().mockResolvedValue({
      success: true,
      output: 'planned',
      tokensUsed: 10,
      toolCalls: 0,
    });
    const mockDestroy = vi.fn();
    const MockSubAgentEngine = vi.fn().mockReturnValue({
      spawn: mockSpawn,
      destroy: mockDestroy,
    });

    vi.doMock('../../src/core/sub-agent.js', () => ({
      SubAgentEngine: MockSubAgentEngine,
    }));
    vi.doMock('../../src/tools/registry.js', () => ({
      ToolRegistry: vi.fn().mockImplementation(() => ({ register: vi.fn() })),
    }));

    const { getBuiltinTools: getToolsFresh } = await import('../../src/tools/builtin.js');
    const tools = getToolsFresh(makeContext());
    const agent = tools.find((t) => t.definition.name === 'agent')!;
    const result = await agent.execute({ prompt: 'plan the feature', type: 'plan' });

    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      'plan the feature',
      expect.anything(),
      expect.objectContaining({ definitionName: 'plan' }),
    );

    vi.doUnmock('../../src/core/sub-agent.js');
    vi.doUnmock('../../src/tools/registry.js');
  });

  it('defaults type to general-purpose (undefined definitionName)', async () => {
    const mockSpawn = vi.fn().mockResolvedValue({
      success: true,
      output: 'done',
      tokensUsed: 10,
      toolCalls: 0,
    });
    const mockDestroy = vi.fn();
    const MockSubAgentEngine = vi.fn().mockReturnValue({
      spawn: mockSpawn,
      destroy: mockDestroy,
    });

    vi.doMock('../../src/core/sub-agent.js', () => ({
      SubAgentEngine: MockSubAgentEngine,
    }));
    vi.doMock('../../src/tools/registry.js', () => ({
      ToolRegistry: vi.fn().mockImplementation(() => ({ register: vi.fn() })),
    }));

    const { getBuiltinTools: getToolsFresh } = await import('../../src/tools/builtin.js');
    const tools = getToolsFresh(makeContext());
    const agent = tools.find((t) => t.definition.name === 'agent')!;
    const result = await agent.execute({ prompt: 'do the thing' });

    expect(result.success).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      'do the thing',
      expect.anything(),
      expect.objectContaining({ definitionName: undefined }),
    );

    vi.doUnmock('../../src/core/sub-agent.js');
    vi.doUnmock('../../src/tools/registry.js');
  });
});

// ---------------------------------------------------------------------------
// getBuiltinTools
// ---------------------------------------------------------------------------

describe('getBuiltinTools', () => {
  it('returns at least 8 builtin tools', () => {
    const tools = getBuiltinTools(makeContext());
    expect(tools.length).toBeGreaterThanOrEqual(8);
  });

  it('returns tools with correct names', () => {
    const tools = getBuiltinTools(makeContext());
    const names = tools.map((t) => t.definition.name);
    expect(names).toContain('bash');
    expect(names).toContain('read');
    expect(names).toContain('write');
    expect(names).toContain('edit');
    expect(names).toContain('grep');
    expect(names).toContain('glob');
    expect(names).toContain('memory');
    expect(names).toContain('agent');
  });

  it('returns tools without context', () => {
    const tools = getBuiltinTools();
    expect(tools.length).toBeGreaterThanOrEqual(8);
    expect(tools.every((t) => t.definition.name && t.definition.description)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ToolRegistry integration
// ---------------------------------------------------------------------------

describe('ToolRegistry integration', () => {
  it('registers and executes all builtin tools', async () => {
    const registry = new ToolRegistry();
    const tools = getBuiltinTools(makeContext());
    registry.registerBatch(tools);

    expect(registry.list()).toContain('bash');
    expect(registry.list()).toContain('read');
    expect(registry.list()).toContain('write');
    expect(registry.list()).toContain('edit');
    expect(registry.list()).toContain('grep');
    expect(registry.list()).toContain('glob');
    expect(registry.list()).toContain('memory');
    expect(registry.list()).toContain('agent');
  });

  it('returns tool definitions for LLM', () => {
    const registry = new ToolRegistry();
    const tools = getBuiltinTools(makeContext());
    registry.registerBatch(tools);

    const defs = registry.getToolDefinitions();
    expect(defs.length).toBeGreaterThanOrEqual(8);
    expect(defs.every((d) => d.name && d.description && d.parameters)).toBe(true);
  });
});
