import type { OrchestratorEvent } from '../core/orchestrator.js';
import type { WebSocket } from 'ws';

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

  broadcast(event: OrchestratorEvent): void {
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
}
