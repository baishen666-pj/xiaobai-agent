import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface MCPServerConfig {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

export class MCPSession {
  private configDir: string;
  private servers = new Map<string, MCPServerConfig>();

  constructor(configDir: string) {
    this.configDir = join(configDir, 'mcp');
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    this.loadConfig();
  }

  private loadConfig(): void {
    const configPath = join(this.configDir, 'servers.json');
    if (!existsSync(configPath)) return;
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const servers = JSON.parse(raw) as MCPServerConfig[];
      for (const server of servers) {
        this.servers.set(server.name, server);
      }
    } catch {
      // Invalid config, skip
    }
  }

  addServer(config: MCPServerConfig): void {
    this.servers.set(config.name, config);
    this.saveConfig();
  }

  removeServer(name: string): boolean {
    if (!this.servers.has(name)) return false;
    this.servers.delete(name);
    this.saveConfig();
    return true;
  }

  getServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  getEnabledServers(): MCPServerConfig[] {
    return Array.from(this.servers.values()).filter((s) => s.enabled);
  }

  private saveConfig(): void {
    const configPath = join(this.configDir, 'servers.json');
    writeFileSync(
      configPath,
      JSON.stringify(Array.from(this.servers.values()), null, 2),
      'utf-8',
    );
  }
}
