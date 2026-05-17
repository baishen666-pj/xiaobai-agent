import type { ClientMessage, ServerAck } from './client-messages.js';
import type { AgentDeps } from '../core/agent.js';
import type { LoopEvent } from '../core/loop.js';
import { XiaobaiAgent } from '../core/agent.js';

export class AgentSession {
  private agent: XiaobaiAgent;
  private sessionId: string;
  private abortController: AbortController | null = null;
  private running = false;

  constructor(
    private deps: AgentDeps,
    sessionId: string,
    private onEvent: (event: LoopEvent) => void,
  ) {
    this.agent = new XiaobaiAgent(deps);
    this.sessionId = sessionId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  isRunning(): boolean {
    return this.running;
  }

  async handleClientMessage(msg: ClientMessage): Promise<ServerAck | void> {
    switch (msg.type) {
      case 'chat_send':
        return this.handleChatSend(msg.content);
      case 'task_cancel':
        return this.handleTaskCancel();
      case 'model_select':
        return this.handleModelSelect(msg.provider, msg.model);
      case 'session_create':
        return this.handleSessionCreate();
      case 'session_list':
        return this.handleSessionList();
      case 'session_resume':
        return this.handleSessionResume(msg.sessionId);
      case 'task_start':
        return this.handleTaskStart(msg.prompt, msg.model, msg.provider);
    }
  }

  private async handleChatSend(content: string): Promise<ServerAck> {
    if (this.running) {
      return { type: 'ack', ok: false, error: 'Session is already running' };
    }

    this.abortController = new AbortController();
    this.running = true;

    const options = {
      abortSignal: this.abortController.signal,
      stream: true,
    };

    this.runBackground(content, this.sessionId, options);

    return { type: 'ack', ok: true };
  }

  private handleTaskCancel(): ServerAck {
    if (!this.running) {
      return { type: 'ack', ok: false, error: 'No active task to cancel' };
    }

    this.abortController?.abort();
    return { type: 'ack', ok: true };
  }

  private handleModelSelect(provider: string, model: string): ServerAck {
    this.agent.setModel(provider, model);
    return { type: 'model_changed', provider, model };
  }

  private async handleSessionCreate(): Promise<ServerAck> {
    this.sessionId = this.deps.sessions.createSession();
    return { type: 'session_created', sessionId: this.sessionId };
  }

  private async handleSessionList(): Promise<ServerAck> {
    const sessions = await this.deps.sessions.listSessions();
    return {
      type: 'session_list_result',
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messageCount,
      })),
    };
  }

  private async handleSessionResume(sessionId: string): Promise<ServerAck> {
    const state = await this.deps.sessions.loadSessionState(sessionId);
    if (!state) {
      return { type: 'ack', ok: false, error: `Session not found: ${sessionId}` };
    }
    this.sessionId = sessionId;
    return { type: 'ack', ok: true };
  }

  private async handleTaskStart(
    prompt: string,
    model?: string,
    provider?: string,
  ): Promise<ServerAck> {
    if (this.running) {
      return { type: 'ack', ok: false, error: 'Session is already running' };
    }

    if (model || provider) {
      this.agent.setModel(provider, model);
    }

    this.sessionId = this.deps.sessions.createSession();
    this.abortController = new AbortController();
    this.running = true;

    this.runBackground(prompt, this.sessionId, {
      abortSignal: this.abortController.signal,
      stream: true,
    });

    return { type: 'session_created', sessionId: this.sessionId };
  }

  private async runBackground(
    message: string,
    sessionId: string,
    options: { abortSignal: AbortSignal; stream: boolean },
  ): Promise<void> {
    try {
      for await (const event of this.agent.chat(message, sessionId, options)) {
        this.onEvent(event);
      }
    } catch (err) {
      this.onEvent({
        type: 'error',
        content: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  destroy(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.running = false;
  }
}
