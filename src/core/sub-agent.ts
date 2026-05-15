import type { ToolResult } from '../tools/registry.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ProviderRouter } from '../provider/router.js';
import type { SessionManager, Message } from '../session/manager.js';
import type { HookSystem } from '../hooks/system.js';
import type { ConfigManager } from '../config/manager.js';
import type { MemorySystem } from '../memory/system.js';
import type { SecurityManager } from '../security/manager.js';
import type { SkillSystem } from '../skills/system.js';
import type { LoopEvent, LoopOptions } from './loop.js';
import { AgentLoop } from './loop.js';
import { CredentialPool, type CredentialLease } from './credential-pool.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BLOCKED_TOOLS = new Set(['agent', 'memory']);
const DEFAULT_MAX_DEPTH = 1;
const MAX_DEPTH_CAP = 3;
const HEARTBEAT_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_CYCLES = 15;
const BUSY_TIMEOUT_CYCLES = 40;

export interface SubAgentDefinition {
  name: string;
  model?: string;
  maxTurns?: number;
  maxDepth?: number;
  allowedTools?: string[];
  blockedTools?: string[];
  systemPrompt: string;
}

export interface SubAgentResult {
  output: string;
  success: boolean;
  tokensUsed: number;
  toolCalls: number;
  error?: string;
}

interface ActiveChild {
  id: string;
  definition: SubAgentDefinition;
  loop: AgentLoop;
  tools: ToolRegistry;
  lease?: CredentialLease;
  lastHeartbeat: number;
  heartbeatCycles: number;
  busy: boolean;
  aborted: boolean;
}

export class SubAgentEngine {
  private provider: ProviderRouter;
  private sessions: SessionManager;
  private hooks: HookSystem;
  private config: ConfigManager;
  private memory: MemorySystem;
  private security: SecurityManager;
  private skills?: SkillSystem;
  private credentialPool: CredentialPool;

  private children = new Map<string, ActiveChild>();
  private maxDepth: number;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  private agentDefinitions = new Map<string, SubAgentDefinition>();

  constructor(deps: {
    provider: ProviderRouter;
    sessions: SessionManager;
    hooks: HookSystem;
    config: ConfigManager;
    memory: MemorySystem;
    security: SecurityManager;
    skills?: SkillSystem;
    credentialPool?: CredentialPool;
  }) {
    this.provider = deps.provider;
    this.sessions = deps.sessions;
    this.hooks = deps.hooks;
    this.config = deps.config;
    this.memory = deps.memory;
    this.security = deps.security;
    this.skills = deps.skills;
    this.credentialPool = deps.credentialPool ?? new CredentialPool();
    this.maxDepth = DEFAULT_MAX_DEPTH;

    this.startHeartbeat();
    this.discoverAgentDefinitions();
  }

  async spawn(
    prompt: string,
    parentTools: ToolRegistry,
    options?: {
      definitionName?: string;
      depth?: number;
      abortSignal?: AbortSignal;
      onEvent?: (event: LoopEvent) => void;
    },
  ): Promise<SubAgentResult> {
    const depth = options?.depth ?? 1;
    if (depth > this.maxDepth) {
      return { output: `Cannot spawn: max depth (${this.maxDepth}) reached`, success: false, tokensUsed: 0, toolCalls: 0, error: 'max_depth_exceeded' };
    }

    const definition = options?.definitionName
      ? this.agentDefinitions.get(options?.definitionName) ?? this.getDefaultDefinition()
      : this.getDefaultDefinition();

    const childTools = this.filterTools(parentTools, definition);

    const childId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sessionId = this.sessions.createSession();

    const lease = this.credentialPool.acquire(definition.model ? undefined : undefined);

    const child: ActiveChild = {
      id: childId,
      definition,
      loop: new AgentLoop({
        provider: this.provider,
        tools: childTools,
        sessions: this.sessions,
        hooks: this.hooks,
        config: this.config,
        memory: this.memory,
        security: this.security,
        skills: this.skills,
      }),
      tools: childTools,
      lease: lease ?? undefined,
      lastHeartbeat: Date.now(),
      heartbeatCycles: 0,
      busy: true,
      aborted: false,
    };

    this.children.set(childId, child);

    try {
      let output = '';
      let tokens = 0;
      let toolCallCount = 0;

      const loopOptions: LoopOptions = {
        maxTurns: definition.maxTurns ?? 20,
        abortSignal: options?.abortSignal,
        stream: false,
      };

      const fullPrompt = definition.systemPrompt
        ? `${definition.systemPrompt}\n\nTask: ${prompt}`
        : prompt;

      for await (const event of child.loop.run(fullPrompt, sessionId, loopOptions)) {
        child.lastHeartbeat = Date.now();
        child.heartbeatCycles = 0;

        options?.onEvent?.(event);

        if (event.type === 'text') output += event.content;
        if (event.type === 'tool_result') toolCallCount++;
        if (event.tokens) tokens += event.tokens;

        if (child.aborted) break;
      }

      return { output, success: true, tokensUsed: tokens, toolCalls: toolCallCount };
    } catch (error) {
      return {
        output: '',
        success: false,
        tokensUsed: 0,
        toolCalls: 0,
        error: (error as Error).message,
      };
    } finally {
      if (child.lease) this.credentialPool.release(child.lease.leaseId);
      this.children.delete(childId);
    }
  }

  interruptAll(): void {
    for (const child of this.children.values()) {
      child.aborted = true;
    }
  }

  getActiveChildren(): Array<{ id: string; name: string; busy: boolean }> {
    return [...this.children.values()].map((c) => ({
      id: c.id,
      name: c.definition.name,
      busy: c.busy,
    }));
  }

  getAvailableDefinitions(): string[] {
    return [...this.agentDefinitions.keys()];
  }

  getDefinition(name: string): SubAgentDefinition | undefined {
    return this.agentDefinitions.get(name);
  }

  setMaxDepth(depth: number): void {
    this.maxDepth = Math.min(depth, MAX_DEPTH_CAP);
  }

  destroy(): void {
    this.interruptAll();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private filterTools(parentTools: ToolRegistry, definition: SubAgentDefinition): ToolRegistry {
    const filtered = new ToolRegistry();
    const blocked = new Set([...BLOCKED_TOOLS, ...(definition.blockedTools ?? [])]);
    const allowed = definition.allowedTools;

    for (const toolDef of parentTools.getToolDefinitions()) {
      if (blocked.has(toolDef.name)) continue;
      if (allowed && !allowed.includes(toolDef.name)) continue;

      const original = parentTools;
      filtered.register({
        definition: toolDef,
        execute: async (args) => original.execute(toolDef.name, args),
      });
    }

    return filtered;
  }

  private getDefaultDefinition(): SubAgentDefinition {
    return {
      name: 'default',
      systemPrompt: 'You are a focused sub-agent. Complete the given task concisely and return results.',
      maxTurns: 15,
      maxDepth: 1,
    };
  }

  private discoverAgentDefinitions(): void {
    const dirs = [
      join(process.cwd(), '.xiaobai', 'agents'),
      join(process.env.HOME ?? process.env.USERPROFILE ?? '~', '.xiaobai', 'agents'),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
        for (const file of files) {
          try {
            const content = readFileSync(join(dir, file), 'utf-8');
            const def = this.parseAgentDefinition(content);
            if (def) this.agentDefinitions.set(def.name, def);
          } catch {
            // Skip malformed agent definition files
          }
        }
      } catch {
        // Skip unreadable directories
      }
    }
  }

  private parseAgentDefinition(content: string): SubAgentDefinition | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const [, yaml, body] = frontmatterMatch;
    const meta: Record<string, string> = {};
    for (const line of yaml.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      meta[key] = val;
    }

    if (!meta.name) return null;

    let allowedTools: string[] | undefined;
    let blockedTools: string[] | undefined;
    try { allowedTools = meta.allowedTools ? JSON.parse(meta.allowedTools) : undefined; } catch {}
    try { blockedTools = meta.blockedTools ? JSON.parse(meta.blockedTools) : undefined; } catch {}

    return {
      name: meta.name,
      model: meta.model || undefined,
      maxTurns: meta.maxTurns ? parseInt(meta.maxTurns, 10) : undefined,
      maxDepth: meta.maxDepth ? parseInt(meta.maxDepth, 10) : undefined,
      allowedTools,
      blockedTools,
      systemPrompt: body.trim(),
    };
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, child] of this.children) {
        child.heartbeatCycles++;
        const maxCycles = child.busy ? BUSY_TIMEOUT_CYCLES : IDLE_TIMEOUT_CYCLES;
        const elapsed = now - child.lastHeartbeat;
        const expectedMax = maxCycles * HEARTBEAT_INTERVAL_MS;

        if (elapsed > expectedMax) {
          child.aborted = true;
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
}
