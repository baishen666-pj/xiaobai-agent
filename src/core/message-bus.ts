import { EventEmitter } from 'node:events';

export interface BusMessage {
  id: string;
  from: string;
  to?: string;
  type: string;
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

export interface BusSubscription {
  id: string;
  agentId: string;
  pattern: string;
}

type BusEventHandler = (message: BusMessage) => void;

interface PendingRequest {
  resolve: (message: BusMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let messageIdCounter = 0;

export class MessageBus {
  private emitter = new EventEmitter();
  private subscriptions = new Map<string, BusSubscription>();
  private pendingRequests = new Map<string, PendingRequest>();
  private history: BusMessage[] = [];
  private maxHistory: number;
  private defaultTimeout: number;

  constructor(options?: { maxHistory?: number; defaultTimeout?: number }) {
    this.maxHistory = options?.maxHistory ?? 1000;
    this.defaultTimeout = options?.defaultTimeout ?? 30_000;
    this.emitter.setMaxListeners(200);
  }

  send(from: string, to: string, type: string, payload: unknown): BusMessage {
    const message: BusMessage = {
      id: `msg_${++messageIdCounter}`,
      from,
      to,
      type,
      payload,
      timestamp: Date.now(),
    };
    this.recordMessage(message);
    this.emitter.emit(`direct:${to}`, message);
    this.emitter.emit(`type:${type}`, message);
    this.emitter.emit('all', message);
    return message;
  }

  broadcast(from: string, type: string, payload: unknown): BusMessage {
    const message: BusMessage = {
      id: `msg_${++messageIdCounter}`,
      from,
      type,
      payload,
      timestamp: Date.now(),
    };
    this.recordMessage(message);
    this.emitter.emit('broadcast', message);
    this.emitter.emit(`type:${type}`, message);
    this.emitter.emit('all', message);
    return message;
  }

  async request(from: string, to: string, type: string, payload: unknown, timeoutMs?: number): Promise<BusMessage> {
    const correlationId = `req_${++messageIdCounter}`;
    const message: BusMessage = {
      id: `msg_${messageIdCounter}`,
      from,
      to,
      type,
      payload,
      timestamp: Date.now(),
      correlationId,
    };
    this.recordMessage(message);

    return new Promise<BusMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Request timed out after ${timeoutMs ?? this.defaultTimeout}ms`));
      }, timeoutMs ?? this.defaultTimeout);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });

      this.emitter.emit(`direct:${to}`, message);
      this.emitter.emit(`type:${type}`, message);
      this.emitter.emit('all', message);
    });
  }

  reply(originalMessage: BusMessage, from: string, payload: unknown): BusMessage {
    const reply: BusMessage = {
      id: `msg_${++messageIdCounter}`,
      from,
      to: originalMessage.from,
      type: `${originalMessage.type}:reply`,
      payload,
      timestamp: Date.now(),
      correlationId: originalMessage.correlationId,
    };
    this.recordMessage(reply);

    const pending = originalMessage.correlationId
      ? this.pendingRequests.get(originalMessage.correlationId)
      : undefined;

    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(originalMessage.correlationId!);
      pending.resolve(reply);
    }

    this.emitter.emit(`direct:${originalMessage.from}`, reply);
    this.emitter.emit(`type:${reply.type}`, reply);
    this.emitter.emit('all', reply);
    return reply;
  }

  subscribe(agentId: string, pattern: string, handler: BusEventHandler): () => void {
    const subId = `sub_${++messageIdCounter}`;
    const sub: BusSubscription = { id: subId, agentId, pattern };
    this.subscriptions.set(subId, sub);

    let cleanup: (() => void)[] = [];

    if (pattern === '*') {
      const listener: BusEventHandler = (msg) => {
        if (msg.to === agentId || !msg.to) handler(msg);
      };
      this.emitter.on('all', listener);
      cleanup.push(() => this.emitter.off('all', listener));
    } else if (pattern.startsWith('type:')) {
      const msgType = pattern.slice(5);
      const listener: BusEventHandler = (msg) => {
        if (msg.to === agentId || !msg.to) handler(msg);
      };
      this.emitter.on(`type:${msgType}`, listener);
      cleanup.push(() => this.emitter.off(`type:${msgType}`, listener));
    } else {
      const listener: BusEventHandler = (msg) => handler(msg);
      this.emitter.on(`direct:${agentId}`, listener);
      cleanup.push(() => this.emitter.off(`direct:${agentId}`, listener));
    }

    return () => {
      this.subscriptions.delete(subId);
      for (const fn of cleanup) fn();
      cleanup = [];
    };
  }

  getHistory(filter?: { type?: string; from?: string; to?: string; limit?: number }): BusMessage[] {
    let msgs = [...this.history];
    if (filter?.type) msgs = msgs.filter((m) => m.type === filter.type);
    if (filter?.from) msgs = msgs.filter((m) => m.from === filter.from);
    if (filter?.to) msgs = msgs.filter((m) => m.to === filter.to);
    const limit = filter?.limit ?? 100;
    return msgs.slice(-limit);
  }

  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  clear(): void {
    this.history = [];
    this.subscriptions.clear();
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Bus cleared'));
    }
    this.pendingRequests.clear();
    this.emitter.removeAllListeners();
  }

  private recordMessage(message: BusMessage): void {
    this.history.push(message);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }
}
