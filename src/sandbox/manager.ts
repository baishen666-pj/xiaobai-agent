import type { XiaobaiConfig } from '../config/manager.js';

export class SandboxManager {
  private mode: XiaobaiConfig['sandbox']['mode'];

  constructor(config: XiaobaiConfig['sandbox']) {
    this.mode = config.mode;
  }

  getMode(): string {
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
    const blocked = ['sudo', 'su', 'chmod 777', 'rm -rf /', 'dd if=', 'mkfs'];
    return !blocked.some((b) => command.includes(b));
  }
}
