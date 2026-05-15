import type { OrchestratorEvent } from '../core/orchestrator.js';
import type { LoopEvent } from '../core/loop.js';
import type { WebSocket } from 'ws';

export type ChatEvent =
  | { type: 'chat_start'; sessionId: string; prompt: string; timestamp: number }
  | { type: 'chat_turn'; sessionId: string; turn: number; tokens: number; content: string }
  | { type: 'chat_tool_call'; sessionId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'chat_tool_result'; sessionId: string; toolName: string; success: boolean; output: string }
  | { type: 'chat_stop'; sessionId: string; reason: string; totalTokens: number }
  | { type: 'chat_error'; sessionId: string; error: string };

export type DashboardEvent = OrchestratorEvent | ChatEvent;

export class EventBridge {
  private clients = new Set<WebSocket>();

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  broadcast(event: DashboardEvent): void {
    const data = JSON.stringify(event);
    const dead: WebSocket[] = [];

    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(data);
      } else {
        dead.push(client);
      }
    }

    for (const d of dead) {
      this.clients.delete(d);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
  }

  createOrchestratorListener(): (event: OrchestratorEvent) => void {
    return (event: OrchestratorEvent) => {
      this.broadcast(event);
    };
  }

  createChatListener(sessionId: string): (event: LoopEvent) => void {
    let turnCount = 0;
    return (event: LoopEvent) => {
      switch (event.type) {
        case 'text':
        case 'stream':
          turnCount++;
          this.broadcast({
            type: 'chat_turn',
            sessionId,
            turn: turnCount,
            tokens: event.tokens ?? 0,
            content: event.content,
          });
          break;
        case 'tool_call':
          this.broadcast({
            type: 'chat_tool_call',
            sessionId,
            toolName: event.toolName ?? 'unknown',
            args: event.toolArgs ?? {},
          });
          break;
        case 'tool_result':
          this.broadcast({
            type: 'chat_tool_result',
            sessionId,
            toolName: event.toolName ?? 'unknown',
            success: event.result?.success ?? false,
            output: event.content,
          });
          break;
        case 'stop':
          this.broadcast({
            type: 'chat_stop',
            sessionId,
            reason: event.content,
            totalTokens: event.tokens ?? 0,
          });
          break;
        case 'error':
          this.broadcast({
            type: 'chat_error',
            sessionId,
            error: event.content,
          });
          break;
      }
    };
  }
}
