import type { A2AClient } from './a2a/client.js';

export interface RemoteAgentConfig {
  url: string;
  protocol: 'a2a' | 'acp';
  name: string;
  role?: string;
}

export interface RemoteTaskResult {
  success: boolean;
  output: string;
  error?: string;
  tokensUsed?: number;
}

export class RemoteAgentBridge {
  private agents = new Map<string, { config: RemoteAgentConfig; client: A2AClient | null }>();

  async registerAgent(config: RemoteAgentConfig): Promise<void> {
    if (config.protocol === 'a2a') {
      const { A2AClient } = await import('./a2a/client.js');
      this.agents.set(config.name, { config, client: new A2AClient(config.url) });
    } else {
      this.agents.set(config.name, { config, client: null });
    }
  }

  unregisterAgent(name: string): void {
    this.agents.delete(name);
  }

  getAgent(name: string): RemoteAgentConfig | undefined {
    return this.agents.get(name)?.config;
  }

  listAgents(): RemoteAgentConfig[] {
    return Array.from(this.agents.values()).map(a => a.config);
  }

  async executeRemoteTask(agentName: string, prompt: string): Promise<RemoteTaskResult> {
    const entry = this.agents.get(agentName);
    if (!entry) {
      return { success: false, output: '', error: `Remote agent "${agentName}" not found` };
    }

    const { config, client } = entry;

    if (config.protocol === 'a2a' && client) {
      try {
        const response = await client.sendMessage(prompt);
        if ('task' in response) {
          const task = response.task;
          if (task.status.state === 'completed') {
            const text = task.history?.slice(-1)[0]?.parts.map(p => p.text ?? '').join('') ?? '';
            return { success: true, output: text };
          }
          return { success: false, output: '', error: `Task state: ${task.status.state}` };
        }
        return { success: false, output: '', error: 'Unexpected response format' };
      } catch (err) {
        return { success: false, output: '', error: (err as Error).message };
      }
    }

    if (config.protocol === 'acp') {
      try {
        const response = await fetch(config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'task/start',
            params: { prompt },
          }),
        });

        if (!response.ok) {
          return { success: false, output: '', error: `HTTP ${response.status}` };
        }

        const data = await response.json() as { result?: { output?: string; success?: boolean; error?: string }; error?: { message: string } };
        if (data.error) {
          return { success: false, output: '', error: data.error.message };
        }
        if (data.result) {
          return {
            success: data.result.success ?? true,
            output: data.result.output ?? '',
            error: data.result.error,
          };
        }
        return { success: false, output: '', error: 'No result in response' };
      } catch (err) {
        return { success: false, output: '', error: (err as Error).message };
      }
    }

    return { success: false, output: '', error: `Unknown protocol: ${config.protocol}` };
  }

  async discoverAgent(agentName: string): Promise<Record<string, unknown> | null> {
    const entry = this.agents.get(agentName);
    if (!entry?.client) return null;

    try {
      const card = await entry.client.discover();
      return card as unknown as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
