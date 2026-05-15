import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export type HookEvent =
  | 'session_start'
  | 'session_end'
  | 'pre_turn'
  | 'post_turn'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'user_prompt_submit'
  | 'stop'
  | 'pre_compact'
  | 'post_compact'
  | 'config_change';

export interface HookHandler {
  event: HookEvent;
  type: 'command' | 'http' | 'prompt' | 'mcp_tool';
  command?: string;
  url?: string;
  async?: boolean;
}

export interface HookResult {
  blocked: boolean;
  reason?: string;
  modified?: Record<string, unknown>;
  output?: string;
}

type HookListener = (data: Record<string, unknown>) => Promise<HookResult | void>;

export class HookSystem {
  private hooksDir: string;
  private handlers = new Map<string, HookHandler[]>();
  private listeners = new Map<string, HookListener[]>();

  constructor(configDir: string) {
    this.hooksDir = join(configDir, 'hooks');
    if (!existsSync(this.hooksDir)) {
      mkdirSync(this.hooksDir, { recursive: true });
    }
    this.loadHooks();
  }

  private loadHooks(): void {
    const hookFile = join(this.hooksDir, 'hooks.json');
    if (!existsSync(hookFile)) return;
    try {
      const raw = readFileSync(hookFile, 'utf-8');
      const config = JSON.parse(raw) as Record<string, HookHandler[]>;
      for (const [event, handlers] of Object.entries(config)) {
        this.handlers.set(event, handlers);
      }
    } catch {
      // Invalid hooks file, skip
    }
  }

  on(event: HookEvent, listener: HookListener): () => void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return () => {
      const current = this.listeners.get(event) ?? [];
      this.listeners.set(event, current.filter((l) => l !== listener));
    };
  }

  async emit(event: string, data: Record<string, unknown> = {}): Promise<HookResult | null> {
    const listeners = this.listeners.get(event) ?? [];
    const handlers = this.handlers.get(event) ?? [];

    for (const listener of listeners) {
      const result = await listener(data);
      if (result?.blocked) return result;
    }

    for (const handler of handlers) {
      const result = await this.executeHandler(handler, data);
      if (result?.blocked) return result;
    }

    return null;
  }

  private async executeHandler(handler: HookHandler, data: Record<string, unknown>): Promise<HookResult | null> {
    switch (handler.type) {
      case 'command':
        return this.executeCommandHook(handler.command!, data);
      case 'http':
        return this.executeHttpHook(handler.url!, data);
      default:
        return null;
    }
  }

  private async executeCommandHook(command: string, data: Record<string, unknown>): Promise<HookResult> {
    try {
      const envData = JSON.stringify(data);
      const result = execSync(command, {
        encoding: 'utf-8',
        timeout: 30000,
        input: envData,
        shell: '/bin/bash',
      });
      if (result.includes('__BLOCK__')) {
        return { blocked: true, reason: result.replace('__BLOCK__', '').trim() };
      }
      return { blocked: false, output: result };
    } catch (error) {
      return { blocked: false, output: `Hook error: ${(error as Error).message}` };
    }
  }

  private async executeHttpHook(url: string, data: Record<string, unknown>): Promise<HookResult> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json() as { blocked?: boolean; reason?: string };
      return {
        blocked: result.blocked ?? false,
        reason: result.reason,
      };
    } catch (error) {
      return { blocked: false, output: `HTTP hook error: ${(error as Error).message}` };
    }
  }

  registerHandler(event: string, handler: HookHandler): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  saveHooks(): void {
    const config: Record<string, HookHandler[]> = {};
    for (const [event, handlers] of this.handlers) {
      config[event] = handlers;
    }
    writeFileSync(join(this.hooksDir, 'hooks.json'), JSON.stringify(config, null, 2), 'utf-8');
  }
}
