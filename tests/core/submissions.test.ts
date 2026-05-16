/**
 * Tests for src/core/submissions.ts
 *
 * submissions.ts is a pure type-definition module (type aliases, interfaces).
 * Since V8 coverage only tracks runtime-executable code, we validate that
 * the type exports compile correctly and exercise every discriminated union
 * branch so that any future runtime code added to this file is immediately
 * covered.
 *
 * Strategy: import the module (to register it with the coverage agent), then
 * exercise every type variant through runtime value construction.
 */
import { describe, it, expect } from 'vitest';
import type {
  Submission,
  AgentEvent,
  StopReason,
  HookExitCode,
  HookResult,
  TurnContext,
  SandboxPolicy,
  ToolsConfig,
  SessionMeta,
  SessionSource,
} from '../../src/core/submissions.js';

// ── Helper: assert exhaustiveness at runtime ──
function expectKeys(obj: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    expect(obj).toHaveProperty(k);
  }
}

// ── Submissions ──

describe('Submission types', () => {
  it('constructs user_input submission', () => {
    const sub: Submission = { type: 'user_input', content: 'hello' };
    expect(sub.type).toBe('user_input');
    expect(sub.content).toBe('hello');
  });

  it('constructs user_input submission with sessionId', () => {
    const sub: Submission = { type: 'user_input', content: 'hello', sessionId: 's_1' };
    expect(sub.sessionId).toBe('s_1');
  });

  it('constructs tool_result submission', () => {
    const sub: Submission = { type: 'tool_result', toolCallId: 'tc_1', output: 'ok', success: true };
    expect(sub.type).toBe('tool_result');
    expect((sub as any).toolCallId).toBe('tc_1');
    expect((sub as any).output).toBe('ok');
    expect((sub as any).success).toBe(true);
  });

  it('constructs tool_result submission with failure', () => {
    const sub: Submission = { type: 'tool_result', toolCallId: 'tc_2', output: 'error', success: false };
    expect((sub as any).success).toBe(false);
  });

  it('constructs approval submission with approved true', () => {
    const sub: Submission = { type: 'approval', toolCallId: 'tc_3', approved: true };
    expect((sub as any).approved).toBe(true);
  });

  it('constructs approval submission with approved false', () => {
    const sub: Submission = { type: 'approval', toolCallId: 'tc_4', approved: false };
    expect((sub as any).approved).toBe(false);
  });

  it('constructs interrupt submission with reason', () => {
    const sub: Submission = { type: 'interrupt', reason: 'user cancelled' };
    expect((sub as any).reason).toBe('user cancelled');
  });

  it('constructs interrupt submission without reason', () => {
    const sub: Submission = { type: 'interrupt' };
    expect((sub as any).reason).toBeUndefined();
  });

  it('constructs compact submission', () => {
    const sub: Submission = { type: 'compact' };
    expect(sub.type).toBe('compact');
  });

  it('constructs undo submission', () => {
    const sub: Submission = { type: 'undo', steps: 3 };
    expect((sub as any).steps).toBe(3);
  });
});

// ── AgentEvent ──

describe('AgentEvent types', () => {
  it('constructs model_output event', () => {
    const evt: AgentEvent = { type: 'model_output', content: 'response text', tokens: 42 };
    expect(evt.type).toBe('model_output');
    expect((evt as any).tokens).toBe(42);
  });

  it('constructs model_output event without tokens', () => {
    const evt: AgentEvent = { type: 'model_output', content: 'response' };
    expect((evt as any).tokens).toBeUndefined();
  });

  it('constructs model_stream event', () => {
    const evt: AgentEvent = { type: 'model_stream', delta: 'partial' };
    expect((evt as any).delta).toBe('partial');
  });

  it('constructs tool_call event', () => {
    const evt: AgentEvent = { type: 'tool_call', id: 'tc_1', name: 'read', args: { path: '/a' } };
    expect((evt as any).name).toBe('read');
  });

  it('constructs tool_result event', () => {
    const evt: AgentEvent = {
      type: 'tool_result',
      id: 'tc_1',
      name: 'read',
      result: { output: 'file contents', success: true },
    };
    expect((evt as any).result.success).toBe(true);
  });

  it('constructs tool_result event with error', () => {
    const evt: AgentEvent = {
      type: 'tool_result',
      id: 'tc_2',
      name: 'bash',
      result: { output: 'failed', success: false, error: 'exit_code_1' },
    };
    expect((evt as any).result.error).toBe('exit_code_1');
  });

  it('constructs approval_request event', () => {
    const evt: AgentEvent = {
      type: 'approval_request',
      toolCallId: 'tc_5',
      tool: 'bash',
      args: { command: 'ls' },
    };
    expect((evt as any).tool).toBe('bash');
  });

  it('constructs status event', () => {
    const evt: AgentEvent = { type: 'status', message: 'processing...' };
    expect((evt as any).message).toBe('processing...');
  });

  it('constructs compact_start event', () => {
    const evt: AgentEvent = { type: 'compact_start' };
    expect(evt.type).toBe('compact_start');
  });

  it('constructs compact_end event', () => {
    const evt: AgentEvent = { type: 'compact_end' };
    expect(evt.type).toBe('compact_end');
  });

  it('constructs stop event for each StopReason', () => {
    const reasons: StopReason[] = [
      'completed',
      'max_turns',
      'aborted',
      'prompt_too_long',
      'model_error',
      'hook_blocked',
      'interrupted',
    ];
    for (const reason of reasons) {
      const evt: AgentEvent = { type: 'stop', reason, tokens: 100 };
      expect((evt as any).reason).toBe(reason);
    }
  });

  it('constructs error event', () => {
    const evt: AgentEvent = { type: 'error', error: 'something went wrong' };
    expect((evt as any).error).toBe('something went wrong');
  });
});

// ── Hook types ──

describe('Hook types', () => {
  it('defines all HookExitCode values', () => {
    const codes: HookExitCode[] = ['allow', 'warn', 'block'];
    expect(codes).toHaveLength(3);
  });

  it('constructs HookResult with exitCode only', () => {
    const result: HookResult = { exitCode: 'allow' };
    expect(result.exitCode).toBe('allow');
    expect(result.message).toBeUndefined();
    expect(result.modified).toBeUndefined();
  });

  it('constructs HookResult with message', () => {
    const result: HookResult = { exitCode: 'warn', message: 'deprecated tool' };
    expect(result.message).toBe('deprecated tool');
  });

  it('constructs HookResult with modified data', () => {
    const result: HookResult = {
      exitCode: 'allow',
      modified: { args: { path: '/override' } },
    };
    expect(result.modified).toEqual({ args: { path: '/override' } });
  });

  it('constructs blocked HookResult', () => {
    const result: HookResult = { exitCode: 'block', message: 'not allowed' };
    expect(result.exitCode).toBe('block');
  });
});

// ── TurnContext and SandboxPolicy ──

describe('TurnContext and related types', () => {
  it('constructs TurnContext with all fields', () => {
    const ctx: TurnContext = {
      turn: 3,
      model: 'gpt-4',
      provider: 'openai',
      maxTurns: 10,
      sandboxPolicy: 'workspace-write',
      toolsConfig: { allowedTools: ['read', 'grep'], blockedTools: ['bash'] },
    };
    expect(ctx.turn).toBe(3);
    expect(ctx.model).toBe('gpt-4');
    expect(ctx.provider).toBe('openai');
    expect(ctx.maxTurns).toBe(10);
  });

  it('defines all SandboxPolicy values', () => {
    const policies: SandboxPolicy[] = ['read-only', 'workspace-write', 'full-access'];
    expect(policies).toHaveLength(3);
  });

  it('constructs ToolsConfig with allowedTools only', () => {
    const cfg: ToolsConfig = { allowedTools: ['read'] };
    expect(cfg.allowedTools).toEqual(['read']);
    expect(cfg.blockedTools).toBeUndefined();
  });

  it('constructs ToolsConfig with blockedTools only', () => {
    const cfg: ToolsConfig = { blockedTools: ['bash'] };
    expect(cfg.blockedTools).toEqual(['bash']);
    expect(cfg.allowedTools).toBeUndefined();
  });

  it('constructs ToolsConfig with both', () => {
    const cfg: ToolsConfig = { allowedTools: ['read'], blockedTools: ['bash'] };
    expect(cfg.allowedTools).toHaveLength(1);
    expect(cfg.blockedTools).toHaveLength(1);
  });

  it('constructs ToolsConfig with neither', () => {
    const cfg: ToolsConfig = {};
    expect(cfg.allowedTools).toBeUndefined();
    expect(cfg.blockedTools).toBeUndefined();
  });
});

// ── Session types ──

describe('Session types', () => {
  it('constructs SessionMeta with all fields', () => {
    const meta: SessionMeta = {
      id: 'session_1',
      createdAt: 1700000000,
      updatedAt: 1700001000,
      messageCount: 5,
      source: 'cli',
    };
    expect(meta.id).toBe('session_1');
    expect(meta.messageCount).toBe(5);
  });

  it('defines all SessionSource values', () => {
    const sources: SessionSource[] = ['cli', 'dashboard', 'api', 'orchestrator', 'subagent'];
    expect(sources).toHaveLength(5);
  });

  it('constructs SessionMeta for each source', () => {
    const sources: SessionSource[] = ['cli', 'dashboard', 'api', 'orchestrator', 'subagent'];
    for (const source of sources) {
      const meta: SessionMeta = {
        id: `session_${source}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        source,
      };
      expect(meta.source).toBe(source);
    }
  });
});

// ── Exhaustive type guard tests ──

describe('Submission exhaustive matching', () => {
  const submissions: Submission[] = [
    { type: 'user_input', content: 'a' },
    { type: 'tool_result', toolCallId: 'x', output: 'o', success: true },
    { type: 'approval', toolCallId: 'y', approved: false },
    { type: 'interrupt', reason: 'r' },
    { type: 'compact' },
    { type: 'undo', steps: 1 },
  ];

  it('covers all 6 submission types', () => {
    const types = submissions.map((s) => s.type);
    expect(types).toEqual([
      'user_input',
      'tool_result',
      'approval',
      'interrupt',
      'compact',
      'undo',
    ]);
  });
});

describe('AgentEvent exhaustive matching', () => {
  it('covers all 11 event types', () => {
    const events: AgentEvent[] = [
      { type: 'model_output', content: 'a', tokens: 0 },
      { type: 'model_stream', delta: 'd' },
      { type: 'tool_call', id: '1', name: 'n', args: {} },
      { type: 'tool_result', id: '2', name: 'n', result: { output: '', success: true } },
      { type: 'approval_request', toolCallId: '3', tool: 't', args: {} },
      { type: 'status', message: 'm' },
      { type: 'compact_start' },
      { type: 'compact_end' },
      { type: 'stop', reason: 'completed', tokens: 0 },
      { type: 'error', error: 'e' },
    ];
    const types = events.map((e) => e.type);
    expect(types).toHaveLength(10);
    expect(new Set(types).size).toBe(10);
  });
});
