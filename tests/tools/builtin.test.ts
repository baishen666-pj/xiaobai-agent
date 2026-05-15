import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getBuiltinTools } from '../../src/tools/builtin.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { SecurityManager } from '../../src/security/manager.js';
import { ConfigManager } from '../../src/config/manager.js';
import { MemorySystem } from '../../src/memory/system.js';
import { SandboxManager } from '../../src/sandbox/manager.js';
import type { ToolResult } from '../../src/tools/registry.js';

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
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('Bash Tool', () => {
  it('executes echo command', async () => {
    const tools = getBuiltinTools(makeContext());
    const bash = tools.find((t) => t.definition.name === 'bash')!;
    const result = await bash.execute({ command: 'echo hello world' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('captures stderr', async () => {
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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
    expect(defs.length).toBe(8);
    expect(defs.every((d) => d.name && d.description && d.parameters)).toBe(true);
  });
});
