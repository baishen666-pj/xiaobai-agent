/**
 * Tests for src/cli/index.ts
 *
 * Strategy: Import the Commander program (parse guarded by !VITEST),
 * then call parseAsync() on specific command/subcommand instances.
 * For subcommands, access them via program.commands to avoid state issues.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { Command } from 'commander';

// ---------------------------------------------------------------------------
// Mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

const mockQuestion = vi.fn();
const mockRlClose = vi.fn();

vi.mock('../../src/core/agent.js', () => {
  const agentInstance = {
    getDeps: vi.fn().mockReturnValue({
      config: {
        get: vi.fn().mockReturnValue({
          model: { default: 'test-model', fallback: '', vision: '', compact: '' },
          provider: { default: 'test-provider' },
          memory: { enabled: true, memoryCharLimit: 100, userCharLimit: 50 },
          skills: { enabled: false },
          sandbox: { mode: 'read-only' },
          hooks: {},
          context: { compressionThreshold: 4000, maxTurns: 30, keepLastN: 4 },
          sessions: { maxHistory: 50 },
          plugins: { enabled: false },
        }),
        getConfigDir: vi.fn().mockReturnValue('/tmp/.xiaobai'),
      },
      provider: { updateConfig: vi.fn() },
      tools: { list: vi.fn().mockReturnValue(['bash', 'read', 'write', 'grep']) },
      sessions: {
        createSession: vi.fn().mockReturnValue('test-session-id'),
        listSessions: vi.fn().mockResolvedValue([
          { id: 's1', messageCount: 5, updatedAt: '2024-01-01T00:00:00Z' },
        ]),
      },
      hooks: { register: vi.fn() },
      memory: {
        list: vi.fn().mockReturnValue(['key1: value1']),
        getUsage: vi.fn().mockReturnValue({
          memory: { used: 50, limit: 100 },
          user: { used: 25, limit: 50 },
        }),
      },
      security: { validate: vi.fn() },
      skills: null,
      plugins: null,
    }),
    getMemory: vi.fn().mockReturnValue({
      list: vi.fn().mockReturnValue(['key1: value1']),
      getUsage: vi.fn().mockReturnValue({
        memory: { used: 50, limit: 100 },
        user: { used: 25, limit: 50 },
      }),
    }),
    getTools: vi.fn().mockReturnValue({
      list: vi.fn().mockReturnValue(['bash', 'read', 'write', 'grep']),
    }),
    getCurrentModel: vi.fn().mockReturnValue({
      provider: 'test-provider',
      model: 'test-model',
    }),
    setModel: vi.fn(),
    getSkills: vi.fn().mockReturnValue(null),
    getPlugins: vi.fn().mockReturnValue(null),
    chat: vi.fn(),
    chatSync: vi.fn().mockResolvedValue('sync-response'),
  };

  return {
    XiaobaiAgent: {
      create: vi.fn().mockResolvedValue(agentInstance),
    },
  };
});

vi.mock('../../src/core/orchestrator.js', () => ({
  Orchestrator: vi.fn().mockImplementation(() => ({
    addTask: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    execute: vi.fn().mockResolvedValue([
      { taskId: 't1', success: true, output: 'done', tokensUsed: 50, error: undefined },
    ]),
  })),
}));

vi.mock('../../src/server/index.js', () => ({
  DashboardServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getHttpUrl: vi.fn().mockReturnValue('http://localhost:3001'),
    getUrl: vi.fn().mockReturnValue('ws://localhost:3001'),
    getBridge: vi.fn().mockReturnValue({
      createChatListener: vi.fn().mockReturnValue(vi.fn()),
    }),
    setGateway: vi.fn(),
    attachOrchestrator: vi.fn(),
    getPort: vi.fn().mockReturnValue(3001),
  })),
}));

vi.mock('../../src/skills/system.js', () => ({
  SkillSystem: {
    listBuiltinNames: vi.fn().mockReturnValue(['code-review', 'testing', 'debugging']),
  },
}));

vi.mock('../../src/core/roles.js', () => ({
  listRoles: vi.fn().mockReturnValue([
    { id: 'coordinator', name: 'Coordinator', description: 'Orchestrates sub-agents.', allowedTools: '*', maxTurns: 30 },
    { id: 'researcher', name: 'Researcher', description: 'Investigates codebases.', allowedTools: ['read', 'grep', 'glob'], maxTurns: 20 },
  ]),
}));

vi.mock('../../src/config/manager.js', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockReturnValue({
      model: { default: 'test-model', fallback: '', vision: '', compact: '' },
      provider: { default: 'test-provider' },
      memory: { enabled: true, memoryCharLimit: 100, userCharLimit: 50 },
      skills: { enabled: false },
      sandbox: { mode: 'read-only' },
      hooks: {},
      context: { compressionThreshold: 4000, maxTurns: 30, keepLastN: 4 },
      sessions: { maxHistory: 50 },
      plugins: { enabled: false },
    }),
    getConfigDir: vi.fn().mockReturnValue('/tmp/.xiaobai'),
  })),
}));

vi.mock('../../src/cli/renderer.js', () => ({
  Spinner: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  })),
  renderMarkdown: vi.fn().mockImplementation((s: string) => s),
  formatToolCall: vi.fn().mockImplementation((o: any) => JSON.stringify(o)),
  formatTokenUsage: vi.fn().mockImplementation((n: number) => `${n} tokens`),
  clearLine: vi.fn(),
  printBanner: vi.fn(),
  printHelp: vi.fn(),
}));

vi.mock('../../src/cli/streaming-renderer.js', () => ({
  StreamingMarkdownRenderer: vi.fn().mockImplementation(() => ({
    push: vi.fn(),
    flush: vi.fn(),
    reset: vi.fn(),
  })),
}));

vi.mock('../../src/cli/permissions.js', () => ({
  PermissionPrompt: vi.fn().mockImplementation(() => ({
    setReadline: vi.fn(),
    checkPermission: vi.fn().mockResolvedValue('allow'),
  })),
}));

vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: mockQuestion,
    close: mockRlClose,
  }),
}));

// Don't mock child_process — execFile for dashboard is handled by real process,
// and execSync for integration tests needs to work

vi.mock('dotenv/config', () => ({}));

vi.mock('../../src/plugins/unified-marketplace.js', () => ({
  UnifiedMarketplace: vi.fn().mockImplementation(() => ({
    search: vi.fn(async () => []),
    browse: vi.fn(async () => []),
    getStats: vi.fn(() => ({ total: 0, installed: 0 })),
    formatList: vi.fn(() => ''),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let program: Command;
const logs: string[] = [];
let origExit: typeof process.exit;
let origLog: typeof console.log;
let origError: typeof console.error;
let origStdoutWrite: typeof process.stdout.write;
const stdoutWrites: string[] = [];

beforeAll(async () => {
  const mod = await import('../../src/cli/index.js');
  program = mod.program;
});

beforeEach(() => {
  logs.length = 0;
  stdoutWrites.length = 0;
  origExit = process.exit;
  origLog = console.log;
  origError = console.error;
  origStdoutWrite = process.stdout.write;
  process.exit = (() => {}) as any;
  console.log = (...args: any[]) => logs.push(args.map(String).join(' '));
  console.error = (...args: any[]) => logs.push(args.map(String).join(' '));
  process.stdout.write = ((chunk: any) => {
    stdoutWrites.push(String(chunk));
    return true;
  }) as any;
  vi.clearAllMocks();
});

afterEach(() => {
  process.exit = origExit;
  console.log = origLog;
  console.error = origError;
  process.stdout.write = origStdoutWrite;
});

function output(): string {
  return [...logs, ...stdoutWrites].join('\n');
}

function findCmd(name: string): Command {
  return program.commands.find(c => c.name() === name)!;
}

function findSubCmd(parent: string, child: string): Command {
  const cmd = findCmd(parent);
  return cmd.commands.find((c: Command) => c.name().split(' ')[0] === child)!;
}

function runCLI(args: string): string {
  try {
    return execSync(`npx tsx src/cli/index.ts ${args}`, {
      cwd: 'E:/CCCC/xiaobai',
      encoding: 'utf-8',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VITEST: '' },
    });
  } catch (e: any) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI index.ts', () => {

  // =========================================================================
  // agents command (no subcommands — parseAsync works directly)
  // =========================================================================

  describe('agents command', () => {
    it('lists roles', async () => {
      await program.parseAsync(['node', 'xiaobai', 'agents']);
      const o = output();
      expect(o).toContain('coordinator');
      expect(o).toContain('Researcher');
      expect(o).toContain('Tools:');
      expect(o).toContain('Max turns:');
    });
  });

  // =========================================================================
  // skills subcommands — use subcommand instances directly
  // =========================================================================

  describe('skills builtins', () => {
    it('lists builtin templates', async () => {
      await findSubCmd('skills', 'builtins').parseAsync(['node', 'xiaobai']);
      const o = output();
      expect(o).toContain('Built-in Skill Templates');
      expect(o).toContain('code-review');
    });
  });

  describe('skills list', () => {
    it('shows not enabled', async () => {
      await findSubCmd('skills', 'list').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Skills system not enabled');
    });
  });

  describe('skills show', () => {
    it('shows not found', async () => {
      await findSubCmd('skills', 'show').parseAsync(['node', 'xiaobai', 'nonexistent']);
      expect(output()).toContain('not found');
    });
  });

  describe('skills create', () => {
    it('shows not enabled', async () => {
      await findSubCmd('skills', 'create').parseAsync(['node', 'xiaobai', 'my-skill']);
      expect(output()).toContain('not enabled');
    });
  });

  describe('skills install', () => {
    it('shows not enabled', async () => {
      await findSubCmd('skills', 'install').parseAsync(['node', 'xiaobai', 'http://example.com']);
      expect(output()).toContain('not enabled');
    });
  });

  describe('skills search', () => {
    it('shows not enabled', async () => {
      await findSubCmd('skills', 'search').parseAsync(['node', 'xiaobai', 'test']);
      expect(output()).toContain('not enabled');
    });
  });

  describe('skills install-builtin', () => {
    it('shows not enabled or already installed', async () => {
      await findSubCmd('skills', 'install-builtin').parseAsync(['node', 'xiaobai']);
      const o = output();
      expect(o.includes('not enabled') || o.includes('already installed')).toBe(true);
    });
  });

  // =========================================================================
  // config command
  // =========================================================================

  describe('config show', () => {
    it('outputs JSON', async () => {
      await findSubCmd('config', 'show').parseAsync(['node', 'xiaobai']);
      const parsed = JSON.parse(output());
      expect(parsed.model).toBeDefined();
      expect(parsed.provider).toBeDefined();
    });
  });

  // =========================================================================
  // memory command
  // =========================================================================

  describe('memory list', () => {
    it('lists entries', async () => {
      await findSubCmd('memory', 'list').parseAsync(['node', 'xiaobai']);
      const o = output();
      expect(o).toContain('Memory:');
      expect(o).toContain('User Profile:');
    });
  });

  // =========================================================================
  // dashboard command
  // =========================================================================

  describe('dashboard', () => {
    it('shows URLs', async () => {
      await findCmd('dashboard').parseAsync(['node', 'xiaobai', '--no-open', '-p', '3001']);
      const o = output();
      expect(o).toContain('Xiaobai Dashboard');
      expect(o).toContain('http://localhost:3001');
      expect(o).toContain('/health');
    });
  });

  // =========================================================================
  // exec command
  // =========================================================================

  describe('exec non-stream', () => {
    it('runs chatSync', async () => {
      await findCmd('exec').parseAsync(['node', 'xiaobai', 'hello']);
      expect(output()).toContain('sync-response');
    });
  });

  describe('exec with --stream', () => {
    it('streams events', async () => {
      const { XiaobaiAgent } = await import('../../src/core/agent.js');
      const agent = await XiaobaiAgent.create();
      function* gen() {
        yield { type: 'stream', content: 'Hi' };
        yield { type: 'stream', content: ' there' };
        yield { type: 'stop' };
      }
      agent.chat = vi.fn().mockReturnValue(gen());
      await findCmd('exec').parseAsync(['node', 'xiaobai', '--stream', 'hi']);
      expect(output()).toContain('Hi');
    });
  });

  describe('exec --dashboard', () => {
    it('starts dashboard', async () => {
      await findCmd('exec').parseAsync(['node', 'xiaobai', 'prompt', '--dashboard']);
      expect(output()).toContain('Dashboard:');
    });
  });

  describe('exec error', () => {
    it('shows error', async () => {
      const { XiaobaiAgent } = await import('../../src/core/agent.js');
      (XiaobaiAgent.create as any).mockRejectedValueOnce(new Error('no key'));
      await findCmd('exec').parseAsync(['node', 'xiaobai', 'fail']);
      expect(output()).toContain('no key');
    });
  });

  // =========================================================================
  // run command
  // =========================================================================

  describe('run command', () => {
    it('shows results', async () => {
      await findCmd('run').parseAsync(['node', 'xiaobai', 'build project']);
      const o = output();
      expect(o).toContain('Running:');
      expect(o).toContain('Results');
      expect(o).toContain('50 tokens');
    });
  });

  describe('run with dashboard', () => {
    it('starts dashboard', async () => {
      await findCmd('run').parseAsync(['node', 'xiaobai', '-p', '3003', 'task']);
      expect(output()).toContain('Dashboard:');
    });
  });

  // =========================================================================
  // plugins subcommands
  // =========================================================================

  describe('plugins list', () => {
    it('shows not enabled or empty', async () => {
      await findSubCmd('plugins', 'list').parseAsync(['node', 'xiaobai']);
      const o = output();
      expect(o.includes('Plugins system not enabled') || o.includes('No plugins installed')).toBe(true);
    });
  });

  describe.skip('plugins create', () => {
    it('creates scaffold', async () => {
      await findSubCmd('plugins', 'create').parseAsync(['node', 'xiaobai', 'test-plug', '-d', 'test']);
      expect(output()).toContain('Created plugin: test-plug');
    });
  });

  describe('plugins install', () => {
    it('shows not enabled', async () => {
      await findSubCmd('plugins', 'install').parseAsync(['node', 'xiaobai', '/tmp/fake']);
      expect(output()).toContain('not enabled');
    });
  });

  describe('plugins uninstall', () => {
    it('shows not enabled', async () => {
      await findSubCmd('plugins', 'uninstall').parseAsync(['node', 'xiaobai', 'fake']);
      expect(output()).toContain('not enabled');
    });
  });

  describe('plugins search', () => {
    it('shows search results or no results', async () => {
      await findSubCmd('plugins', 'search').parseAsync(['node', 'xiaobai', 'weather']);
      const o = output();
      expect(o.includes('No') || o.includes('weather') || o.includes('Search') || o.includes('Plugin')).toBe(true);
    });
  });

  describe('plugins browse', () => {
    it('shows browse results or empty', async () => {
      await findSubCmd('plugins', 'browse').parseAsync(['node', 'xiaobai']);
      const o = output();
      expect(o.includes('No plugins') || o.includes('Plugin') || o.includes('Browse')).toBe(true);
    });
  });

  describe('plugins activate', () => {
    it('shows not enabled', async () => {
      await findSubCmd('plugins', 'activate').parseAsync(['node', 'xiaobai', 'test-plugin']);
      expect(output()).toContain('not enabled');
    });
  });

  describe('plugins deactivate', () => {
    it('shows not enabled', async () => {
      await findSubCmd('plugins', 'deactivate').parseAsync(['node', 'xiaobai', 'test-plugin']);
      expect(output()).toContain('not enabled');
    });
  });

  // =========================================================================
  // chat command
  // =========================================================================

  describe('chat /exit', () => {
    it('exits', async () => {
      mockQuestion.mockImplementation((_p: string, cb: (s: string) => void) => cb('/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Goodbye');
    });
  });

  describe('chat /quit', () => {
    it('exits', async () => {
      mockQuestion.mockImplementation((_p: string, cb: (s: string) => void) => cb('/quit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Goodbye');
    });
  });

  describe('chat /help', () => {
    it('calls printHelp', async () => {
      const inputs = ['/help', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Goodbye');
    });
  });

  describe('chat /memory', () => {
    it('shows usage', async () => {
      const inputs = ['/memory', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Memory:');
      expect(output()).toContain('50/100');
    });
  });

  describe('chat /tools', () => {
    it('lists tools', async () => {
      const inputs = ['/tools', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Tools (4)');
    });
  });

  describe('chat /clear', () => {
    it('clears session', async () => {
      const inputs = ['/clear', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Session cleared');
    });
  });

  describe('chat /compact', () => {
    it('shows message', async () => {
      const inputs = ['/compact', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Compaction is automatic');
    });
  });

  describe('chat /sessions', () => {
    it('lists sessions', async () => {
      const inputs = ['/sessions', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('s1');
    });
  });

  describe('chat /sessions empty', () => {
    it('shows no saved sessions', async () => {
      const { XiaobaiAgent } = await import('../../src/core/agent.js');
      const agent = await XiaobaiAgent.create();
      agent.getDeps().sessions.listSessions = vi.fn().mockResolvedValue([]);
      const inputs = ['/sessions', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('No saved sessions');
    });
  });

  describe('chat /model (view)', () => {
    it('shows model', async () => {
      const inputs = ['/model', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('test-provider');
    });
  });

  describe('chat /model (switch)', () => {
    it('switches model', async () => {
      const inputs = ['/model openai', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Switched to');
    });
  });

  describe('chat /model provider+model', () => {
    it('switches both', async () => {
      const inputs = ['/model openai gpt-4', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Switched to openai/gpt-4');
    });
  });

  describe('chat empty input', () => {
    it('re-prompts', async () => {
      const inputs = ['', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Goodbye');
    });
  });

  describe('chat normal message', () => {
    it('sends to agent and handles text event', async () => {
      const { XiaobaiAgent } = await import('../../src/core/agent.js');
      const agent = await XiaobaiAgent.create();
      function* gen() {
        yield { type: 'text', content: 'AI says hi' };
        yield { type: 'stop', tokens: 50 };
      }
      agent.chat = vi.fn().mockReturnValue(gen());
      const inputs = ['hello', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('AI says hi');
    });
  });

  describe.skip('chat tool_call + tool_result events', () => {
    it('formats tool calls', async () => {
      const { XiaobaiAgent } = await import('../../src/core/agent.js');
      const agent = await XiaobaiAgent.create();
      // Sync generator to avoid async timing issues
      function* gen() {
        yield { type: 'tool_call', toolName: 'bash', toolArgs: { cmd: 'ls' } };
        yield { type: 'tool_result', toolName: 'bash', result: { success: true, output: 'file.txt' } };
        yield { type: 'stop' };
      }
      agent.chat = vi.fn().mockReturnValue(gen());
      const inputs = ['run ls', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p: any, cb: (s: string) => void) => { cb(inputs[i++] ?? '/exit'); });
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('bash');
    });
  });

  describe.skip('chat compact event', () => {
    it('shows compacting', async () => {
      const { XiaobaiAgent } = await import('../../src/core/agent.js');
      const agent = await XiaobaiAgent.create();
      function* gen() {
        yield { type: 'compact' };
        yield { type: 'stop' };
      }
      agent.chat = vi.fn().mockReturnValue(gen());
      const inputs = ['test', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p: any, cb: (s: string) => void) => { cb(inputs[i++] ?? '/exit'); });
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Goodbye');
    });
  });

  describe('chat error event', () => {
    it('shows error', async () => {
      const { XiaobaiAgent } = await import('../../src/core/agent.js');
      const agent = await XiaobaiAgent.create();
      function* gen() {
        yield { type: 'error', content: 'rate limited' };
        yield { type: 'stop' };
      }
      agent.chat = vi.fn().mockReturnValue(gen());
      const inputs = ['test', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('rate limited');
    });
  });

  describe('chat exception', () => {
    it('handles thrown error', async () => {
      const { XiaobaiAgent } = await import('../../src/core/agent.js');
      const agent = await XiaobaiAgent.create();
      agent.chat = vi.fn().mockImplementation(() => {
        throw new Error('network fail');
      });
      const inputs = ['test', '/exit'];
      let i = 0;
      mockQuestion.mockImplementation((_p, cb) => cb(inputs[i++] ?? '/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('network fail');
    });
  });

  describe('chat --auto', () => {
    it('passes auto to PermissionPrompt', async () => {
      mockQuestion.mockImplementation((_p, cb) => cb('/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai', '--auto']);
      expect(output()).toContain('Goodbye');
    });
  });

  describe('chat --dashboard', () => {
    it('starts dashboard', async () => {
      mockQuestion.mockImplementation((_p, cb) => cb('/exit'));
      await findCmd('chat').parseAsync(['node', 'xiaobai', '--dashboard']);
      expect(output()).toContain('Dashboard:');
    });
  });

  describe('chat creation error', () => {
    it('shows failure', async () => {
      const { XiaobaiAgent } = await import('../../src/core/agent.js');
      (XiaobaiAgent.create as any).mockRejectedValueOnce(new Error('init fail'));
      await findCmd('chat').parseAsync(['node', 'xiaobai']);
      expect(output()).toContain('Failed to start');
    });
  });

  // =========================================================================
  // Integration (subprocess)
  // =========================================================================

  describe('integration (subprocess)', () => {
    it('has all commands in help', () => {
      const out = runCLI('--help');
      for (const cmd of ['chat', 'exec', 'memory', 'config', 'dashboard', 'run', 'agents', 'skills', 'plugins']) {
        expect(out).toContain(cmd);
      }
    });

    it('version is 0.9.0', () => {
      expect(runCLI('--version').trim()).toBe('0.9.0');
    });
  });
});
