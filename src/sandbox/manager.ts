import type { XiaobaiConfig } from '../config/manager.js';

export type SandboxMode = 'read-only' | 'workspace-write' | 'full-access';
export type NetworkMode = 'allow-all' | 'deny-all' | 'allow-list';

export interface SandboxConfig {
  mode: SandboxMode;
  network: NetworkMode;
  allowedDomains: string[];
  blockedCommands: string[];
  maxExecutionTimeMs: number;
  maxMemoryMb: number;
}

export interface ToolPolicy {
  allowedTools: Set<string>;
  blockedTools: Set<string>;
}

const BLOCKED_COMMANDS_DEFAULT = [
  'sudo', 'su', 'chmod 777', 'rm -rf /', 'dd if=', 'mkfs',
  'shutdown', 'reboot', 'halt', 'format',
];

export class SandboxManager {
  private mode: SandboxMode;
  private network: NetworkMode;
  private allowedDomains: Set<string>;
  private blockedCommands: Set<string>;
  private maxExecutionTimeMs: number;
  private sessionPolicies = new Map<string, ToolPolicy>();

  constructor(config: XiaobaiConfig['sandbox']) {
    this.mode = config.mode;
    this.network = config.network ?? 'allow-all';
    this.allowedDomains = new Set(config.allowedDomains ?? []);
    this.blockedCommands = new Set([...BLOCKED_COMMANDS_DEFAULT, ...(config.blockedCommands ?? [])]);
    this.maxExecutionTimeMs = config.maxExecutionTimeMs ?? 30000;
  }

  getMode(): SandboxMode {
    return this.mode;
  }

  isReadOnly(): boolean {
    return this.mode === 'read-only';
  }

  isWorkspaceWrite(): boolean {
    return this.mode === 'workspace-write';
  }

  isFullAccess(): boolean {
    return this.mode === 'full-access';
  }

  canWrite(path: string, cwd: string): boolean {
    if (this.isFullAccess()) return true;
    if (this.isReadOnly()) return false;
    return path.startsWith(cwd);
  }

  canExecute(command: string): boolean {
    if (this.isFullAccess()) return true;
    if (this.isReadOnly()) return false;
    return ![...this.blockedCommands].some((b) => command.includes(b));
  }

  canAccessNetwork(domain: string): boolean {
    if (this.network === 'allow-all') return true;
    if (this.network === 'deny-all') return false;
    return this.allowedDomains.has(domain);
  }

  getMaxExecutionTime(): number {
    return this.maxExecutionTimeMs;
  }

  // ── Per-session tool policies ──

  setSessionPolicy(sessionId: string, policy: Partial<ToolPolicy>): void {
    const existing = this.sessionPolicies.get(sessionId) ?? {
      allowedTools: new Set<string>(),
      blockedTools: new Set<string>(),
    };
    if (policy.allowedTools) {
      for (const t of policy.allowedTools) existing.allowedTools.add(t);
    }
    if (policy.blockedTools) {
      for (const t of policy.blockedTools) existing.blockedTools.add(t);
    }
    this.sessionPolicies.set(sessionId, existing);
  }

  clearSessionPolicy(sessionId: string): void {
    this.sessionPolicies.delete(sessionId);
  }

  isToolAllowed(tool: string, sessionId?: string): boolean {
    if (sessionId) {
      const policy = this.sessionPolicies.get(sessionId);
      if (policy) {
        if (policy.blockedTools.has(tool)) return false;
        if (policy.allowedTools.size > 0 && !policy.allowedTools.has(tool)) return false;
      }
    }
    return true;
  }

  // ── Execution context ──

  getExecutionContext(command: string, cwd: string): ExecutionContext {
    return {
      sandbox: this.mode,
      canWrite: this.canWrite(cwd, cwd),
      canExecute: this.canExecute(command),
      maxTimeMs: this.maxExecutionTimeMs,
    };
  }
}

export interface ExecutionContext {
  sandbox: SandboxMode;
  canWrite: boolean;
  canExecute: boolean;
  maxTimeMs: number;
}
