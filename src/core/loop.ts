import type { ToolRegistry, ToolResult } from '../tools/registry.js';
import type { ProviderRouter } from '../provider/router.js';
import type { SessionManager, Message } from '../session/manager.js';
import type { HookSystem, HookResult } from '../hooks/system.js';
import type { ConfigManager } from '../config/manager.js';
import type { MemorySystem } from '../memory/system.js';
import type { SecurityManager } from '../security/manager.js';
import type { SkillSystem } from '../skills/system.js';
import type { Submission, AgentEvent, StopReason, TurnContext, SandboxPolicy } from './submissions.js';
import { CompactionEngine } from './compaction.js';
import { loadHierarchicalContext, buildContextSystemPrompt } from './context.js';

export type { StopReason } from './submissions.js';

export interface LoopState {
  turn: number;
  messages: Message[];
  totalTokens: number;
  lastCompactTokens: number;
  stopReason?: StopReason;
  error?: Error;
}

export interface LoopEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'error' | 'stop' | 'compact' | 'stream';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: ToolResult;
  tokens?: number;
}

export interface LoopOptions {
  maxTurns?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: LoopEvent) => void;
  permissionCallback?: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
  stream?: boolean;
}

export class AgentLoop {
  private provider: ProviderRouter;
  private tools: ToolRegistry;
  private sessions: SessionManager;
  private hooks: HookSystem;
  private config: ConfigManager;
  private memory: MemorySystem;
  private security: SecurityManager;
  private compaction: CompactionEngine;
  private skills?: SkillSystem;

  private submissionQueue: Submission[] = [];
  private eventBuffer: AgentEvent[] = [];
  private running = false;

  constructor(deps: {
    provider: ProviderRouter;
    tools: ToolRegistry;
    sessions: SessionManager;
    hooks: HookSystem;
    config: ConfigManager;
    memory: MemorySystem;
    security: SecurityManager;
    skills?: SkillSystem;
  }) {
    this.provider = deps.provider;
    this.tools = deps.tools;
    this.sessions = deps.sessions;
    this.hooks = deps.hooks;
    this.config = deps.config;
    this.memory = deps.memory;
    this.security = deps.security;
    this.skills = deps.skills;
    this.compaction = new CompactionEngine(deps.provider);
  }

  // ── Queue-Pair API ──

  submit(submission: Submission): void {
    this.submissionQueue.push(submission);
  }

  drainEvents(): AgentEvent[] {
    const events = [...this.eventBuffer];
    this.eventBuffer = [];
    return events;
  }

  private emitEvent(event: AgentEvent): void {
    this.eventBuffer.push(event);
  }

  // ── Legacy async generator API (backward compatible) ──

  async *run(
    userMessage: string,
    sessionId: string,
    options: LoopOptions = {},
  ): AsyncGenerator<LoopEvent, void, void> {
    const cfg = this.config.get();
    const maxTurns = options.maxTurns ?? cfg.context.maxTurns;
    const useStream = options.stream ?? false;
    const state: LoopState = {
      turn: 0,
      messages: [],
      totalTokens: 0,
      lastCompactTokens: 0,
    };

    try {
      await this.hooks.emit('session_start', { sessionId });
      state.messages = await this.sessions.loadMessages(sessionId);
      state.messages.push({ role: 'user', content: userMessage });

      const hookResult = await this.hooks.emit('user_prompt_submit', { message: userMessage, sessionId });
      if (hookResult.exitCode === 'block') {
        state.stopReason = 'hook_blocked';
        yield { type: 'error', content: hookResult.message ?? 'Blocked by hook' };
        return;
      }

      while (state.turn < maxTurns) {
        if (options.abortSignal?.aborted) {
          state.stopReason = 'aborted';
          yield { type: 'stop', content: 'Aborted by user' };
          return;
        }

        // Check for pending submissions (interrupts, etc.)
        const pending = this.submissionQueue.shift();
        if (pending?.type === 'interrupt') {
          state.stopReason = 'interrupted';
          yield { type: 'stop', content: pending.reason ?? 'Interrupted' };
          return;
        }

        await this.hooks.emit('pre_turn', { state, sessionId });
        state.turn++;

        const systemPrompt = await this.buildSystemPrompt(sessionId);

        if (useStream) {
          yield* this.processStreamTurn(state, systemPrompt, options);
        } else {
          yield* this.processTurn(state, systemPrompt, options);
        }

        if (state.stopReason) break;

        if (this.shouldCompact(state)) {
          await this.hooks.emit('pre_compact', { state, sessionId });
          yield { type: 'compact', content: 'Compressing context...' };
          await this.compactContext(state);
          await this.hooks.emit('post_compact', { state, sessionId });
        }

        await this.hooks.emit('post_turn', { state, sessionId });
      }

      if (state.turn >= maxTurns && !state.stopReason) {
        state.stopReason = 'max_turns';
        yield { type: 'stop', content: `Reached max turns (${maxTurns})` };
      }
    } catch (error) {
      state.error = error instanceof Error ? error : new Error(String(error));
      state.stopReason = 'model_error';
      yield { type: 'error', content: state.error.message };
    } finally {
      await this.sessions.saveMessages(sessionId, state.messages);
      if (cfg.memory.enabled) {
        await this.memory.flushIfDirty();
      }
      await this.hooks.emit('stop', { reason: state.stopReason, tokens: state.totalTokens });
    }
  }

  // ── Internal turn processing ──

  private async *processTurn(
    state: LoopState,
    systemPrompt: string,
    options: LoopOptions,
  ): AsyncGenerator<LoopEvent, void, void> {
    const response = await this.provider.chat(state.messages, {
      system: systemPrompt,
      tools: this.tools.getToolDefinitions(),
    });

    if (!response) {
      state.stopReason = 'model_error';
      yield { type: 'error', content: 'No response from provider' };
      return;
    }

    state.totalTokens += response.usage?.totalTokens ?? 0;

    if (response.content) {
      yield { type: 'text', content: response.content, tokens: response.usage?.totalTokens };
    }

    if (response.toolCalls?.length) {
      state.messages.push({
        role: 'assistant',
        content: response.content ?? '',
        toolCalls: response.toolCalls,
      });

      const results = await this.executeToolCalls(response.toolCalls, options);
      for (const { call, result } of results) {
        yield {
          type: 'tool_result',
          content: result.output,
          toolName: call.name,
          result,
        };
        state.messages.push({
          role: 'tool_result',
          toolCallId: call.id,
          content: result.output,
        });
      }
    } else {
      if (response.content) {
        state.messages.push({ role: 'assistant', content: response.content });
      }
      state.stopReason = 'completed';
      yield { type: 'stop', content: 'Task completed' };
    }

  }

  private async *processStreamTurn(
    state: LoopState,
    systemPrompt: string,
    options: LoopOptions,
  ): AsyncGenerator<LoopEvent, void, void> {
    let fullContent = '';
    let totalTokens = 0;
    const toolCallStates = new Map<number, { id: string; name: string; args: string }>();

    try {
      for await (const chunk of this.provider.chatStream(state.messages, {
        system: systemPrompt,
        tools: this.tools.getToolDefinitions(),
        abortSignal: options.abortSignal,
      })) {
        switch (chunk.type) {
          case 'text_delta':
            fullContent += chunk.text ?? '';
            yield { type: 'stream', content: chunk.text ?? '' };
            break;
          case 'tool_call_start':
            if (chunk.toolCallId && chunk.toolCallName) {
              const idx = toolCallStates.size;
              toolCallStates.set(idx, { id: chunk.toolCallId, name: chunk.toolCallName, args: '' });
            }
            yield { type: 'tool_call', content: '', toolName: chunk.toolCallName, toolArgs: {} };
            break;
          case 'tool_call_delta':
            // Append delta args to the last tool call
            if (chunk.toolCallDelta) {
              for (const [, tc] of toolCallStates) {
                if (tc.id === chunk.toolCallId) {
                  tc.args += chunk.toolCallDelta;
                  break;
                }
              }
            }
            break;
          case 'usage':
            totalTokens += chunk.usage?.totalTokens ?? 0;
            break;
          case 'done':
            state.totalTokens += totalTokens;

            // Collect completed tool calls from the stream's state
            const toolCalls: ToolCall[] = [];
            for (const [, tc] of toolCallStates) {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.args || '{}');
              } catch {
                parsedArgs = { _raw: tc.args };
              }
              toolCalls.push({
                id: tc.id,
                name: tc.name,
                arguments: parsedArgs,
              });
            }

            if (toolCalls.length > 0 || chunk.stopReason === 'tool_calls' || chunk.stopReason === 'tool_use') {
              // Need to collect tool calls from stream — they were emitted but not captured
              // The provider's chatStream emits tool_call_start/delta chunks with the data
              // We need to reconstruct from the StreamChunk types
              state.messages.push({
                role: 'assistant',
                content: fullContent || '',
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              });

              if (toolCalls.length > 0) {
                const results = await this.executeToolCalls(toolCalls, options);
                for (const { call, result } of results) {
                  yield {
                    type: 'tool_result',
                    content: result.output,
                    toolName: call.name,
                    result,
                  };
                  state.messages.push({
                    role: 'tool_result',
                    toolCallId: call.id,
                    content: result.output,
                  });
                }
              }
            } else {
              if (fullContent) {
                state.messages.push({ role: 'assistant', content: fullContent });
              }
              state.stopReason = 'completed';
              yield { type: 'stop', content: 'Task completed' };
            }
            break;
        }
      }
    } catch (error) {
      yield { type: 'error', content: `Stream error: ${(error as Error).message}` };
    }
  }

  private async executeToolCalls(
    calls: ToolCall[],
    options: LoopOptions,
  ): Promise<Array<{ call: ToolCall; result: ToolResult }>> {
    const isConcurrencySafe = (name: string) => ['read', 'grep', 'glob'].includes(name);
    const safeCalls = calls.filter((c) => isConcurrencySafe(c.name));
    const unsafeCalls = calls.filter((c) => !isConcurrencySafe(c.name));

    const executeOne = async (call: ToolCall): Promise<{ call: ToolCall; result: ToolResult }> => {
      const args = call.arguments as Record<string, unknown>;

      const hookResult = await this.hooks.emit('pre_tool_use', { tool: call.name, args });
      if (hookResult.exitCode === 'block') {
        return {
          call,
          result: { output: `Blocked by hook: ${hookResult.message}`, success: false },
        };
      }

      const allowed = options.permissionCallback
        ? await options.permissionCallback(call.name, args)
        : await this.security.checkPermission(call.name, args);

      if (!allowed) {
        return {
          call,
          result: { output: 'Permission denied', success: false, error: 'permission_denied' },
        };
      }

      const result = await this.tools.execute(call.name, args);
      await this.hooks.emit('post_tool_use', { tool: call.name, args, result });
      return { call, result };
    };

    const results: Array<{ call: ToolCall; result: ToolResult }> = [];

    if (safeCalls.length > 0) {
      const safeResults = await Promise.all(safeCalls.map(executeOne));
      results.push(...safeResults);
    }

    for (const call of unsafeCalls) {
      results.push(await executeOne(call));
    }

    return results;
  }

  private async buildSystemPrompt(sessionId: string): Promise<string> {
    const parts: string[] = [];
    parts.push('You are Xiaobai, a helpful AI coding assistant.');

    const memBlock = await this.memory.getSystemPromptBlock();
    if (memBlock) parts.push(memBlock);

    const skillBlock = await this.loadSkillSummary();
    if (skillBlock) parts.push(skillBlock);

    const contextBlock = this.loadProjectContext();
    if (contextBlock) parts.push(contextBlock);

    return parts.join('\n\n');
  }

  private async loadSkillSummary(): Promise<string | null> {
    if (!this.skills) return null;
    return this.skills.buildSystemPrompt() || null;
  }

  private loadProjectContext(): string | null {
    try {
      const context = loadHierarchicalContext(process.cwd());
      return buildContextSystemPrompt(context);
    } catch {
      return null;
    }
  }

  private shouldCompact(state: LoopState): boolean {
    return this.compaction.shouldCompact(state.messages, state.totalTokens, state.lastCompactTokens);
  }

  private async compactContext(state: LoopState): Promise<void> {
    const result = await this.compaction.compact(state.messages);
    state.messages = result.messages;
    state.lastCompactTokens = state.totalTokens;
  }
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ProviderResponse {
  content?: string;
  toolCalls?: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}
