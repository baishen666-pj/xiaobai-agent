import { describe, it, expect, beforeEach } from 'vitest';
import { RemoteAgentBridge } from '../../src/protocols/orchestrator-bridge.js';

describe('RemoteAgentBridge', () => {
  let bridge: RemoteAgentBridge;

  beforeEach(() => {
    bridge = new RemoteAgentBridge();
  });

  it('registers and lists agents', async () => {
    await bridge.registerAgent({
      url: 'http://localhost:4120',
      protocol: 'a2a',
      name: 'remote-analyst',
      role: 'analyst',
    });

    const agents = bridge.listAgents();
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('remote-analyst');
    expect(agents[0].protocol).toBe('a2a');
  });

  it('gets agent by name', async () => {
    await bridge.registerAgent({
      url: 'http://localhost:4121',
      protocol: 'acp',
      name: 'remote-coder',
    });

    const agent = bridge.getAgent('remote-coder');
    expect(agent).toBeDefined();
    expect(agent?.protocol).toBe('acp');
  });

  it('unregisters agent', async () => {
    await bridge.registerAgent({
      url: 'http://localhost:4120',
      protocol: 'a2a',
      name: 'temp',
    });

    bridge.unregisterAgent('temp');
    expect(bridge.listAgents().length).toBe(0);
    expect(bridge.getAgent('temp')).toBeUndefined();
  });

  it('fails for unknown agent', async () => {
    const result = await bridge.executeRemoteTask('nonexistent', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('fails when remote agent is unreachable', async () => {
    await bridge.registerAgent({
      url: 'http://localhost:19999',
      protocol: 'a2a',
      name: 'dead-agent',
    });

    const result = await bridge.executeRemoteTask('dead-agent', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('fails for ACP unreachable agent', async () => {
    await bridge.registerAgent({
      url: 'http://localhost:19999',
      protocol: 'acp',
      name: 'dead-acp',
    });

    const result = await bridge.executeRemoteTask('dead-acp', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns null from discoverAgent for ACP agent (no client)', async () => {
    await bridge.registerAgent({
      url: 'http://localhost:19999',
      protocol: 'acp',
      name: 'acp-no-discover',
    });

    const card = await bridge.discoverAgent('acp-no-discover');
    expect(card).toBeNull();
  });

  it('returns null from discoverAgent for unregistered agent', async () => {
    const card = await bridge.discoverAgent('nonexistent');
    expect(card).toBeNull();
  });

  it('returns null from discoverAgent when discovery fails', async () => {
    await bridge.registerAgent({
      url: 'http://localhost:19999',
      protocol: 'a2a',
      name: 'dead-discover',
    });

    const card = await bridge.discoverAgent('dead-discover');
    expect(card).toBeNull();
  });

  it('lists multiple agents', async () => {
    await bridge.registerAgent({ url: 'http://localhost:4120', protocol: 'a2a', name: 'agent-1' });
    await bridge.registerAgent({ url: 'http://localhost:4121', protocol: 'acp', name: 'agent-2' });

    const agents = bridge.listAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map(a => a.name)).toContain('agent-1');
    expect(agents.map(a => a.name)).toContain('agent-2');
  });

  it('overwrites agent on re-register', async () => {
    await bridge.registerAgent({ url: 'http://localhost:4120', protocol: 'a2a', name: 'dup' });
    await bridge.registerAgent({ url: 'http://localhost:4121', protocol: 'acp', name: 'dup' });

    const agents = bridge.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].protocol).toBe('acp');
  });
});
