import type { AgentCard, A2AMessage, SendMessageResponse, A2ATask } from './types.js';
import { Role } from './types.js';

export class A2AClient {
  private baseUrl: string;
  private agentCard: AgentCard | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async discover(): Promise<AgentCard> {
    const response = await fetch(`${this.baseUrl}/.well-known/agent-card.json`);
    if (!response.ok) throw new Error(`Failed to discover agent: ${response.status}`);
    this.agentCard = await response.json() as AgentCard;
    return this.agentCard;
  }

  async sendMessage(text: string, options?: { contextId?: string }): Promise<SendMessageResponse> {
    const message: A2AMessage = {
      messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: Role.USER,
      parts: [{ text }],
    };

    const configuration: Record<string, unknown> = { acceptedOutputModes: ['text/plain'] };
    if (options?.contextId) configuration.contextId = options.contextId;

    const response = await fetch(`${this.baseUrl}/message/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, configuration }),
    });

    if (!response.ok) throw new Error(`A2A send failed: ${response.status}`);
    return response.json() as Promise<SendMessageResponse>;
  }

  async *sendStreamingMessage(text: string, options?: { contextId?: string }): AsyncGenerator<A2ATask> {
    const message: A2AMessage = {
      messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: Role.USER,
      parts: [{ text }],
    };

    const configuration: Record<string, unknown> = { acceptedOutputModes: ['text/plain'] };
    if (options?.contextId) configuration.contextId = options.contextId;

    const response = await fetch(`${this.baseUrl}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, configuration }),
    });

    if (!response.ok) throw new Error(`A2A stream failed: ${response.status}`);
    if (!response.body) throw new Error('No response body for streaming');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ') && currentEvent === 'task_update') {
          try {
            const task = JSON.parse(line.slice(6)) as A2ATask;
            yield task;
          } catch { /* skip malformed */ }
        }
      }
    }
  }

  async getTask(taskId: string): Promise<A2ATask> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`);
    if (!response.ok) throw new Error(`A2A get task failed: ${response.status}`);
    return response.json() as Promise<A2ATask>;
  }

  async listTasks(filter?: { status?: string; limit?: number; offset?: number }): Promise<{ tasks: A2ATask[] }> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.limit) params.set('limit', String(filter.limit));
    if (filter?.offset) params.set('offset', String(filter.offset));
    const qs = params.toString();
    const url = `${this.baseUrl}/tasks${qs ? `?${qs}` : ''}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`A2A list tasks failed: ${response.status}`);
    return response.json() as Promise<{ tasks: A2ATask[] }>;
  }

  async cancelTask(taskId: string): Promise<A2ATask> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}/cancel`, { method: 'POST' });
    if (!response.ok) throw new Error(`A2A cancel failed: ${response.status}`);
    return response.json() as Promise<A2ATask>;
  }

  getAgentCard(): AgentCard | null {
    return this.agentCard;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
