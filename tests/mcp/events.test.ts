import { describe, it, expect, beforeEach } from 'vitest';
import { MCPEventEmitter } from '../../src/mcp/events.js';
import type { MCPEvent } from '../../src/mcp/events.js';

describe('MCPEventEmitter', () => {
  let emitter: MCPEventEmitter;

  beforeEach(() => {
    emitter = new MCPEventEmitter();
  });

  it('emits typed events', () => {
    const events: MCPEvent[] = [];
    emitter.onType('connected', (e) => events.push(e));

    emitter.emitMCP({ type: 'connected', serverName: 'test' });
    expect(events).toHaveLength(1);
    expect(events[0].serverName).toBe('test');
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it('emits wildcard events', () => {
    const events: MCPEvent[] = [];
    emitter.onAny((e) => events.push(e));

    emitter.emitMCP({ type: 'connected', serverName: 'a' });
    emitter.emitMCP({ type: 'mcp_error', serverName: 'b', data: 'oops' });
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('connected');
    expect(events[1].type).toBe('mcp_error');
  });

  it('onType returns unsubscribe function', () => {
    const events: MCPEvent[] = [];
    const unsub = emitter.onType('disconnected', (e) => events.push(e));

    emitter.emitMCP({ type: 'disconnected', serverName: 'test' });
    expect(events).toHaveLength(1);

    unsub();
    emitter.emitMCP({ type: 'disconnected', serverName: 'test' });
    expect(events).toHaveLength(1);
  });

  it('onAny returns unsubscribe function', () => {
    const events: MCPEvent[] = [];
    const unsub = emitter.onAny((e) => events.push(e));

    emitter.emitMCP({ type: 'connected', serverName: 'test' });
    unsub();
    emitter.emitMCP({ type: 'connected', serverName: 'test' });
    expect(events).toHaveLength(1);
  });

  it('supports all event types', () => {
    const types: string[] = [];
    emitter.onAny((e) => types.push(e.type));

    emitter.emitMCP({ type: 'connected', serverName: 'a' });
    emitter.emitMCP({ type: 'disconnected', serverName: 'a' });
    emitter.emitMCP({ type: 'tools_changed', serverName: 'a' });
    emitter.emitMCP({ type: 'resources_changed', serverName: 'a' });
    emitter.emitMCP({ type: 'mcp_error', serverName: 'a' });

    expect(types).toEqual(['connected', 'disconnected', 'tools_changed', 'resources_changed', 'mcp_error']);
  });

  it('carries data in events', () => {
    const events: MCPEvent[] = [];
    emitter.onType('mcp_error', (e) => events.push(e));

    emitter.emitMCP({ type: 'mcp_error', serverName: 'test', data: { code: 500 } });
    expect(events[0].data).toEqual({ code: 500 });
  });
});
