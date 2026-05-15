import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { EventBridge } from '../../src/server/eventBridge.js';
import type { LoopEvent } from '../../src/core/loop.js';

describe('EventBridge ChatEvent', () => {
  let bridge: EventBridge;

  beforeEach(() => {
    bridge = new EventBridge();
  });

  it('createChatListener returns a function', () => {
    const listener = bridge.createChatListener('test-session');
    expect(typeof listener).toBe('function');
  });

  it('translates text LoopEvent to chat_turn', () => {
    const listener = bridge.createChatListener('sess-1');
    const events: any[] = [];
    bridge.broadcast = (event: any) => events.push(event);

    const loopEvent: LoopEvent = { type: 'text', content: 'Hello world', tokens: 10 };
    listener(loopEvent);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('chat_turn');
    expect(events[0].sessionId).toBe('sess-1');
    expect(events[0].content).toBe('Hello world');
    expect(events[0].tokens).toBe(10);
  });

  it('translates tool_call LoopEvent to chat_tool_call', () => {
    const listener = bridge.createChatListener('sess-1');
    const events: any[] = [];
    bridge.broadcast = (event: any) => events.push(event);

    const loopEvent: LoopEvent = {
      type: 'tool_call',
      content: '',
      toolName: 'read',
      toolArgs: { path: '/test.txt' },
    };
    listener(loopEvent);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('chat_tool_call');
    expect(events[0].toolName).toBe('read');
    expect(events[0].args).toEqual({ path: '/test.txt' });
  });

  it('translates tool_result LoopEvent to chat_tool_result', () => {
    const listener = bridge.createChatListener('sess-1');
    const events: any[] = [];
    bridge.broadcast = (event: any) => events.push(event);

    const loopEvent: LoopEvent = {
      type: 'tool_result',
      content: 'file contents',
      toolName: 'read',
      result: { output: 'file contents', success: true },
    };
    listener(loopEvent);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('chat_tool_result');
    expect(events[0].success).toBe(true);
  });

  it('translates stop LoopEvent to chat_stop', () => {
    const listener = bridge.createChatListener('sess-1');
    const events: any[] = [];
    bridge.broadcast = (event: any) => events.push(event);

    const loopEvent: LoopEvent = {
      type: 'stop',
      content: 'completed',
      tokens: 500,
    };
    listener(loopEvent);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('chat_stop');
    expect(events[0].reason).toBe('completed');
    expect(events[0].totalTokens).toBe(500);
  });

  it('translates error LoopEvent to chat_error', () => {
    const listener = bridge.createChatListener('sess-1');
    const events: any[] = [];
    bridge.broadcast = (event: any) => events.push(event);

    const loopEvent: LoopEvent = {
      type: 'error',
      content: 'Something went wrong',
    };
    listener(loopEvent);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('chat_error');
    expect(events[0].error).toBe('Something went wrong');
  });

  it('ignores compact and thinking events', () => {
    const listener = bridge.createChatListener('sess-1');
    const events: any[] = [];
    bridge.broadcast = (event: any) => events.push(event);

    listener({ type: 'compact', content: '' });
    listener({ type: 'thinking', content: '' });

    expect(events).toHaveLength(0);
  });

  it('increments turn counter for text events', () => {
    const listener = bridge.createChatListener('sess-1');
    const events: any[] = [];
    bridge.broadcast = (event: any) => events.push(event);

    listener({ type: 'text', content: 'first' });
    listener({ type: 'text', content: 'second' });
    listener({ type: 'text', content: 'third' });

    expect(events).toHaveLength(3);
    expect(events[0].turn).toBe(1);
    expect(events[1].turn).toBe(2);
    expect(events[2].turn).toBe(3);
  });
});

describe('EventBridge WebSocket ChatEvent', () => {
  let bridge: EventBridge;
  let server: ReturnType<typeof createServer>;
  let wss: WebSocketServer;
  let ws: WebSocket;
  let port: number;

  beforeEach(async () => {
    bridge = new EventBridge();
    server = createServer();
    wss = new WebSocketServer({ server });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) port = addr.port;
        resolve();
      });
    });

    wss.on('connection', (client) => bridge.addClient(client));

    ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => ws.on('open', resolve));
  });

  afterEach(async () => {
    ws.close();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('broadcasts chat_turn events to WebSocket clients', async () => {
    const listener = bridge.createChatListener('ws-test');
    const received: any[] = [];

    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
    });

    listener({ type: 'text', content: 'Hello from chat' });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].type).toBe('chat_turn');
    expect(received[0].content).toBe('Hello from chat');
    expect(received[0].sessionId).toBe('ws-test');
  });

  it('broadcasts multiple chat events in order', async () => {
    const listener = bridge.createChatListener('ws-test');
    const received: any[] = [];

    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
    });

    listener({ type: 'tool_call', content: '', toolName: 'bash', toolArgs: { cmd: 'ls' } });
    listener({ type: 'tool_result', content: 'output', toolName: 'bash', result: { output: 'output', success: true } });
    listener({ type: 'stop', content: 'completed', tokens: 100 });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(received).toHaveLength(3);
    expect(received[0].type).toBe('chat_tool_call');
    expect(received[1].type).toBe('chat_tool_result');
    expect(received[2].type).toBe('chat_stop');
  });
});
