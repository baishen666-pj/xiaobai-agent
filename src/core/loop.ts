import type { ToolRegistry, ToolResult } from '../tools/registry.js';
import type { ProviderRouter } from '../provider/router.js';
import type { SessionManager, Message } from '../session/manager.js';
import type { HookSystem } from '../hooks/system.js';
import type { ConfigManager } from '../config/manager.js';
import type { MemorySystem } from '../memory/system.js';
import type { SecurityManager } from '../security/manager.js';

export type StopReason =
  | 'completed'
  | 'max_turns'
  | 'aborted'
  | 'prompt_too_long'
  | 'model_error'
  | 'hook_stopped'
  | 'blocking_limit'
  | 'diminishing_returns';

export interface LoopState {
  turn: number;
  messages: Message[];
  totalTokens: number;
  lastCompactTokens: number;
  stopReason?: StopReason;
  error?: Error;
}

export interface LoopEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'error' | 'stop' | 'compact';
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
}

export class AgentLoop {
  private provider: ProviderRouter;
  private tools: ToolRegistry;
  private sessions: SessionManager;
  private hooks: HookSystem;
  private config: ConfigManager;
  private memory: MemorySystem;
  private security: SecurityManager;

  constructor(deps: {
    provider: ProviderRouter;
    tools: ToolRegistry;
    sessions: SessionManager;
    hooks: HookSystem;
    config: ConfigManager;
    memory: MemorySystem;
    security: SecurityManager;
  }) {
    this.provider = deps.provider;
    this.tools = deps.tools;
    this.sessions = deps.sessions;
    this.hooks = deps.hooks;
    this.config = deps.config;
    this.memory = deps.memory;
    this.security = deps.security;
  }

  async *run(
    userMessage: string,
    sessionId: string,
    options: LoopOptions = {},
  ): AsyncGenerator<LoopEvent, void, void> {
    const cfg = this.config.get();
    const maxTurns = options.maxTurns ?? cfg.context.maxTurns;
    const state: LoopState = {
      turn: 0,
      messages: [],
      totalTokens: 0,
      lastCompactTokens: 0,
    };

    try {
      state.messages = await this.sessions.loadMessages(sessionId);
      state.messages.push({ role: 'user', content: userMessage });

      while (state.turn < maxTurns) {
        if (options.abortSignal?.aborted) {
          state.stopReason = 'aborted';
          yield { type: 'stop', content: 'Aborted by user' };
          return;
        }

        await this.hooks.emit('pre_turn', { state, sessionId });
        state.turn++;

        const systemPrompt = await this.buildSystemPrompt(sessionId);
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
          state.messages.push({ role: 'assistant', content: response.content });
          yield { type: 'text', content: response.content, tokens: response.usage?.totalTokens };

          if (!response.toolCalls?.length) {
            state.stopReason = 'completed';
            yield { type: 'stop', content: 'Task completed' };
            break;
          }
        }

        if (response.toolCalls?.length) {
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
        }

        if (this.shouldCompact(state)) {
          yield { type: 'compact', content: 'Compressing context...' };
          await this.compactContext(state);
        }

        await this.hooks.emit('post_turn', { state, sessionId });
      }

      if (state.turn >= maxTurns) {
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
      const allowed = options.permissionCallback
        ? await options.permissionCallback(call.name, args)
        : await this.security.checkPermission(call.name, args);

      if (!allowed) {
        return {
          call,
          result: { output: 'Permission denied', success: false, error: 'permission_denied' },
        };
      }

      const hookResult = await this.hooks.emit('pre_tool_use', {
        tool: call.name,
        args,
      });
      if (hookResult?.blocked) {
        return {
          call,
          result: { output: `Blocked by hook: ${hookResult.reason}`, success: false },
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

    const instructions = await this.loadInstructions();
    if (instructions) parts.push(instructions);

    return parts.join('\n\n');
  }

  private async loadSkillSummary(): Promise<string | null> {
    return null;
  }

  private async loadInstructions(): Promise<string | null> {
    return null;
  }

  private shouldCompact(state: LoopState): boolean {
    const cfg = this.config.get();
    const threshold = cfg.context.compressionThreshold;
    return state.totalTokens - state.lastCompactTokens > 100_000 * threshold;
  }

  private async compactContext(state: LoopState): Promise<void> {
    const keep = this.config.get().context.keepLastN;
    const messages = state.messages;
    if (messages.length <= keep) return;

    const oldMessages = messages.slice(0, -keep);
    const summary = await this.provider.summarize(oldMessages);
    state.messages = [
      { role: 'system', content: `[Context Summary]\n${summary}` },
      ...messages.slice(-keep),
    ];
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
