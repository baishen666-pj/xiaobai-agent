import { EventEmitter } from 'node:events';

export type MCPEventType = 'connected' | 'disconnected' | 'tools_changed' | 'resources_changed' | 'mcp_error';

export interface MCPEvent {
  type: MCPEventType;
  serverName: string;
  data?: unknown;
  timestamp: number;
}

const ANY_EVENT = '__mcp_any__';

export class MCPEventEmitter extends EventEmitter {
  emitMCP(event: Omit<MCPEvent, 'timestamp'>): void {
    const fullEvent: MCPEvent = { ...event, timestamp: Date.now() };
    this.emit(event.type, fullEvent);
    this.emit(ANY_EVENT, fullEvent);
  }

  onType(type: MCPEventType, handler: (event: MCPEvent) => void): () => void {
    this.on(type, handler);
    return () => this.off(type, handler);
  }

  onAny(handler: (event: MCPEvent) => void): () => void {
    this.on(ANY_EVENT, handler);
    return () => this.off(ANY_EVENT, handler);
  }
}
