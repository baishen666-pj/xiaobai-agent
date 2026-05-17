import type { RemoteAgentBridge } from './orchestrator-bridge.js';

export interface AgentMarketplaceEntry {
  id: string;
  name: string;
  description: string;
  protocol: 'a2a' | 'acp';
  url: string;
  role?: string;
  author: string;
  version: string;
  rating: number;
  verified: boolean;
  tags: string[];
}

export class AgentMarketplace {
  private entries = new Map<string, AgentMarketplaceEntry>();
  private bridge?: RemoteAgentBridge;
  private installed = new Set<string>();

  constructor(bridge?: RemoteAgentBridge) {
    this.bridge = bridge;
  }

  register(entry: AgentMarketplaceEntry): void {
    this.entries.set(entry.id, entry);
  }

  unregister(id: string): boolean {
    return this.entries.delete(id);
  }

  get(id: string): AgentMarketplaceEntry | undefined {
    return this.entries.get(id);
  }

  search(query: string): AgentMarketplaceEntry[] {
    const lower = query.toLowerCase();
    return this.listAll().filter(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        e.description.toLowerCase().includes(lower) ||
        e.tags.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  browse(tag?: string): AgentMarketplaceEntry[] {
    if (!tag) return this.listAll();
    const lower = tag.toLowerCase();
    return this.listAll().filter((e) =>
      e.tags.some((t) => t.toLowerCase() === lower),
    );
  }

  async install(id: string): Promise<{ success: boolean; error?: string }> {
    const entry = this.entries.get(id);
    if (!entry) return { success: false, error: `Entry "${id}" not found` };
    if (!this.bridge) return { success: false, error: 'No remote agent bridge configured' };

    try {
      await this.bridge.registerAgent({
        name: entry.name,
        url: entry.url,
        protocol: entry.protocol,
        role: entry.role,
      });
      this.installed.add(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  isInstalled(id: string): boolean {
    return this.installed.has(id);
  }

  listAll(): AgentMarketplaceEntry[] {
    return Array.from(this.entries.values());
  }

  getStats(): { total: number; installed: number } {
    return {
      total: this.entries.size,
      installed: this.installed.size,
    };
  }

  setBridge(bridge: RemoteAgentBridge): void {
    this.bridge = bridge;
  }
}
