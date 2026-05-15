import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { HookExitCode } from '../core/submissions.js';

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
  | 'config_change'
  | 'permission_request';

export interface HookHandler {
  event: HookEvent;
  type: 'command' | 'http' | 'prompt';
  command?: string;
  url?: string;
  async?: boolean;
}

export interface HookResult {
  exitCode: HookExitCode;
  message?: string;
  modified?: Record<string, unknown>;
}

export const ALLOW: HookResult = { exitCode: 'allow' };
export const WARN = (message: string): HookResult => ({ exitCode: 'warn', message });
export const BLOCK = (message: string): HookResult => ({ exitCode: 'block', message });

type HookListener = (data: Record<string, unknown>) => Promise<HookResult | void> | HookResult | void;

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
    } catch {}
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

  async emit(event: string, data: Record<string, unknown> = {}): Promise<HookResult> {
    const listeners = this.listeners.get(event) ?? [];
    const handlers = this.handlers.get(event) ?? [];
    let worst: HookResult = ALLOW;

    const updateWorst = (hr: HookResult) => {
      if (hr.exitCode === 'block') return true;
      if (hr.exitCode === 'warn' && worst.exitCode === 'allow') worst = hr;
      return false;
    };

    for (const listener of listeners) {
      const result = await listener(data);
      if (result && typeof result === 'object' && 'exitCode' in result) {
        if (updateWorst(result as HookResult)) return result as HookResult;
      }
    }

    for (const handler of handlers) {
      const result = await this.executeHandler(handler, data);
      if (result) {
        if (updateWorst(result)) return result;
      }
    }

    return worst;
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

  private executeCommandHook(command: string, data: Record<string, unknown>): HookResult {
    try {
      const envData = JSON.stringify(data);
      const result = execSync(command, {
        encoding: 'utf-8',
        timeout: 30000,
        input: envData,
        shell: '/bin/bash',
      });

      if (result.includes('__BLOCK__')) {
        return BLOCK(result.replace('__BLOCK__', '').trim());
      }
      if (result.includes('__WARN__')) {
        return WARN(result.replace('__WARN__', '').trim());
      }
      return { exitCode: 'allow', message: result };
    } catch (error) {
      const exitCode = (error as any)?.status;
      if (exitCode === 2) {
        return BLOCK((error as any)?.stderr?.toString()?.trim() ?? 'Blocked by hook');
      }
      if (exitCode === 1) {
        return WARN((error as any)?.stderr?.toString()?.trim() ?? 'Hook warning');
      }
      return { exitCode: 'allow', message: `Hook error: ${(error as Error).message}` };
    }
  }

  private async executeHttpHook(url: string, data: Record<string, unknown>): Promise<HookResult> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json() as { exitCode?: string; blocked?: boolean; reason?: string; message?: string };
      const code = result.exitCode ?? (result.blocked ? 'block' : 'allow');
      return {
        exitCode: code as HookExitCode,
        message: result.reason ?? result.message,
      };
    } catch (error) {
      return { exitCode: 'allow', message: `HTTP hook error: ${(error as Error).message}` };
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
