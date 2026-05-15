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

    const response = await fetch(`${this.baseUrl}/message/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, configuration: { acceptedOutputModes: ['text/plain'] } }),
    });

    if (!response.ok) throw new Error(`A2A send failed: ${response.status}`);
    return response.json() as Promise<SendMessageResponse>;
  }

  async getTask(taskId: string): Promise<A2ATask> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`);
    if (!response.ok) throw new Error(`A2A get task failed: ${response.status}`);
    return response.json() as Promise<A2ATask>;
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
