import type { XiaobaiConfig } from '../config/manager.js';

export class SecurityManager {
  private config: XiaobaiConfig;
  private approvedCommands = new Set<string>();
  private deniedCommands = new Set<string>();
  private trustedToolTypes = new Set<string>();

  constructor(config: XiaobaiConfig) {
    this.config = config;
    this.deniedCommands = new Set(config.permissions.deny);
  }

  async checkPermission(tool: string, args: Record<string, unknown>): Promise<boolean> {
    const mode = this.config.permissions.mode;

    if (mode === 'plan') {
      return ['read', 'grep', 'glob'].includes(tool);
    }

    if (mode === 'accept-edits' && ['edit', 'write'].includes(tool)) {
      return true;
    }

    if (mode === 'auto') {
      return this.autoApprove(tool, args);
    }

    // Check trusted tool types
    if (this.trustedToolTypes.has(tool)) {
      return true;
    }

    // default mode: check allowlist
    if (this.config.permissions.allow.includes(tool)) {
      return true;
    }

    // Check denylist
    if (this.config.permissions.deny.includes(tool)) {
      return false;
    }

    // For bash, check command patterns
    if (tool === 'bash') {
      return this.checkBashPermission(args['command'] as string);
    }

    // Default: allow read tools, deny write tools
    return ['read', 'grep', 'glob'].includes(tool);
  }

  private autoApprove(tool: string, args: Record<string, unknown>): boolean {
    if (this.deniedCommands.has(tool)) return false;
    if (['read', 'grep', 'glob'].includes(tool)) return true;

    if (tool === 'bash') {
      const cmd = args['command'] as string;
      const dangerous = this.isDangerousCommand(cmd);
      return !dangerous;
    }

    return true;
  }

  private checkBashPermission(command?: string): boolean {
    if (!command) return false;
    return !this.isDangerousCommand(command);
  }

  isDangerousCommand(command: string): boolean {
    const dangerousPatterns = [
      /\brm\s+(-rf?|-fr?)\s+\//,
      /\bdd\s+if=/,
      /\bformat\s+[a-zA-Z]:\\/i,
      /\b(?:shutdown|reboot|halt|poweroff)\b/,
      />\s*\/dev\/(?:sda|hda|nvme|sd[a-z])/,
      /\b(?:curl|wget)\s+.*\|\s*(?:ba)?sh/,
      /\b(?:sudo|runas)\s+/,
      /\b(?:chmod|chown)\s+777/,
      /\bpython[23]?\s+-c\s+/,
      /\bperl\s+-e\s+/,
      /\bruby\s+-e\s+/,
      /\bnode\s+-e\s+/,
      /\bpowershell\s+-enc\b/i,
      /\bpowershell\s+-command\s+/i,
      /\bcmd\s+\/c\s+/i,
      /\b(?:nc|ncat|netcat)\s+-e\b/,
      /\bsocat\s+.*exec:/,
      /\bmkfifo\b/,
      /\biptables\b/,
      /\bsystemctl\s+(?:stop|disable|mask)\s+/,
      /\bservice\s+\w+\s+stop\b/,
      /\bkill\s+-9\s+1\b/,
      />\s*>?\s*\/etc\//,
    ];
    return dangerousPatterns.some((p) => p.test(command));
  }

  approveCommand(command: string): void {
    this.approvedCommands.add(command);
  }

  denyCommand(command: string): void {
    this.deniedCommands.add(command);
  }

  isApproved(command: string): boolean {
    return this.approvedCommands.has(command);
  }

  addTrustedToolType(toolName: string): void {
    this.trustedToolTypes.add(toolName);
  }

  isToolTypeTrusted(toolName: string): boolean {
    return this.trustedToolTypes.has(toolName);
  }
}
