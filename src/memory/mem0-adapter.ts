export interface MemoryBackend {
  add(scope: string, content: string): Promise<{ success: boolean; error?: string }>;
  remove(scope: string, oldText: string): Promise<{ success: boolean; error?: string }>;
  replace(scope: string, oldText: string, newContent: string): Promise<{ success: boolean; error?: string }>;
  list(scope: string): Promise<string[]>;
  getSystemPromptBlock(): Promise<string | null>;
  flush(): Promise<void>;
}

export class LocalMemoryBackend implements MemoryBackend {
  private entries = new Map<string, string[]>();
  private charLimit: number;

  constructor(charLimit = 2200) {
    this.charLimit = charLimit;
  }

  async add(scope: string, content: string): Promise<{ success: boolean; error?: string }> {
    const entries = this.entries.get(scope) ?? [];
    const currentChars = entries.reduce((s, e) => s + e.length, 0);
    if (currentChars + content.length > this.charLimit) {
      return { success: false, error: `Exceeds ${this.charLimit} char limit` };
    }
    if (entries.includes(content)) return { success: true };
    entries.push(content);
    this.entries.set(scope, entries);
    return { success: true };
  }

  async remove(scope: string, oldText: string): Promise<{ success: boolean; error?: string }> {
    const entries = this.entries.get(scope) ?? [];
    const idx = entries.findIndex((e) => e.includes(oldText));
    if (idx === -1) return { success: false, error: 'No matching entry' };
    entries.splice(idx, 1);
    this.entries.set(scope, entries);
    return { success: true };
  }

  async replace(scope: string, oldText: string, newContent: string): Promise<{ success: boolean; error?: string }> {
    const entries = this.entries.get(scope) ?? [];
    const idx = entries.findIndex((e) => e.includes(oldText));
    if (idx === -1) return { success: false, error: 'No matching entry' };
    entries[idx] = newContent;
    this.entries.set(scope, entries);
    return { success: true };
  }

  async list(scope: string): Promise<string[]> {
    return [...(this.entries.get(scope) ?? [])];
  }

  async getSystemPromptBlock(): Promise<string | null> {
    const blocks: string[] = [];
    for (const [scope, entries] of this.entries) {
      if (entries.length > 0) {
        blocks.push(`══ ${scope.toUpperCase()} ══\n${entries.join('\n')}`);
      }
    }
    return blocks.length > 0 ? blocks.join('\n\n') : null;
  }

  async flush(): Promise<void> {
    // Local backend is in-memory only, no-op
  }
}

export class Mem0Backend implements MemoryBackend {
  private apiKey: string;
  private baseUrl: string;
  private userId: string;
  private agentId: string;
  private cache = new Map<string, string[]>();

  constructor(config: { apiKey: string; baseUrl?: string; userId?: string; agentId?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.mem0.ai/v1';
    this.userId = config.userId ?? 'xiaobai-default';
    this.agentId = config.agentId ?? 'xiaobai-agent';
  }

  async add(scope: string, content: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/memories/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${this.apiKey}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content }],
          user_id: this.userId,
          agent_id: this.agentId,
          metadata: { scope },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { success: false, error: `Mem0 API error: ${response.status} ${err}` };
      }

      this.cache.delete(scope);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async remove(scope: string, oldText: string): Promise<{ success: boolean; error?: string }> {
    try {
      const entries = await this.list(scope);
      const match = entries.find((e) => e.includes(oldText));
      if (!match) return { success: false, error: 'No matching entry' };

      // Mem0 doesn't have a direct delete-by-content API
      // We search and delete by ID
      const searchResponse = await fetch(
        `${this.baseUrl}/memories/?user_id=${this.userId}&agent_id=${this.agentId}`,
        { headers: { 'Authorization': `Token ${this.apiKey}` } },
      );

      if (searchResponse.ok) {
        const data = await searchResponse.json() as { results?: Array<{ id: string; memory: string }> };
        const found = data.results?.find((r) => r.memory === match);
        if (found) {
          await fetch(`${this.baseUrl}/memories/${found.id}/`, {
            method: 'DELETE',
            headers: { 'Authorization': `Token ${this.apiKey}` },
          });
        }
      }

      this.cache.delete(scope);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async replace(scope: string, oldText: string, newContent: string): Promise<{ success: boolean; error?: string }> {
    const removeResult = await this.remove(scope, oldText);
    if (!removeResult.success) return removeResult;
    return this.add(scope, newContent);
  }

  async list(scope: string): Promise<string[]> {
    const cached = this.cache.get(scope);
    if (cached) return cached;

    try {
      const response = await fetch(
        `${this.baseUrl}/memories/?user_id=${this.userId}&agent_id=${this.agentId}`,
        { headers: { 'Authorization': `Token ${this.apiKey}` } },
      );

      if (!response.ok) return [];

      const data = await response.json() as { results?: Array<{ memory: string; metadata?: { scope?: string } }> };
      const filtered = (data.results ?? [])
        .filter((r) => r.metadata?.scope === scope)
        .map((r) => r.memory);

      this.cache.set(scope, filtered);
      return filtered;
    } catch (e) {
      console.debug('mem0: list failed, returning empty', (e as Error).message);
      return [];
    }
  }

  async getSystemPromptBlock(): Promise<string | null> {
    const blocks: string[] = [];
    for (const scope of ['long-term', 'state']) {
      const entries = await this.list(scope);
      if (entries.length > 0) {
        blocks.push(`══ ${scope.toUpperCase()} ══\n${entries.join('\n')}`);
      }
    }
    return blocks.length > 0 ? blocks.join('\n\n') : null;
  }

  async flush(): Promise<void> {
    this.cache.clear();
  }
}

export function createMemoryBackend(config?: {
  backend?: 'local' | 'mem0';
  mem0?: { apiKey: string; baseUrl?: string; userId?: string; agentId?: string };
}): MemoryBackend {
  if (config?.backend === 'mem0' && config.mem0?.apiKey) {
    return new Mem0Backend(config.mem0);
  }
  return new LocalMemoryBackend();
}
