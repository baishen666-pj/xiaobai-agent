import type { ToolResult } from '../tools/registry.js';

// ── Submissions (into the agent loop) ──

export type Submission =
  | { type: 'user_input'; content: string; sessionId?: string }
  | { type: 'tool_result'; toolCallId: string; output: string; success: boolean }
  | { type: 'approval'; toolCallId: string; approved: boolean }
  | { type: 'interrupt'; reason?: string }
  | { type: 'compact' }
  | { type: 'undo'; steps: number };

// ── Events (out of the agent loop) ──

export type AgentEvent =
  | { type: 'model_output'; content: string; tokens?: number }
  | { type: 'model_stream'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; result: ToolResult }
  | { type: 'approval_request'; toolCallId: string; tool: string; args: Record<string, unknown> }
  | { type: 'status'; message: string }
  | { type: 'compact_start' }
  | { type: 'compact_end' }
  | { type: 'stop'; reason: StopReason; tokens: number }
  | { type: 'error'; error: string };

export type StopReason =
  | 'completed'
  | 'max_turns'
  | 'aborted'
  | 'prompt_too_long'
  | 'model_error'
  | 'hook_blocked'
  | 'interrupted';

// ── Hook results ──

export type HookExitCode = 'allow' | 'warn' | 'block';

export interface HookResult {
  exitCode: HookExitCode;
  message?: string;
  modified?: Record<string, unknown>;
}

// ── Turn context ──

export interface TurnContext {
  turn: number;
  model: string;
  provider: string;
  maxTurns: number;
  sandboxPolicy: SandboxPolicy;
  toolsConfig: ToolsConfig;
}

export type SandboxPolicy = 'read-only' | 'workspace-write' | 'full-access';

export interface ToolsConfig {
  allowedTools?: string[];
  blockedTools?: string[];
}

// ── Session info ──

export interface SessionMeta {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  source: SessionSource;
}

export type SessionSource = 'cli' | 'dashboard' | 'api' | 'orchestrator' | 'subagent';
