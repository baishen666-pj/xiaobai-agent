import { describe, it, expect, vi, beforeEach } from 'vitest';
import { XiaobaiAgent, type AgentDeps } from '../../src/core/agent.js';

function createMockDeps(): AgentDeps {
  return {
    config: {
      get: vi.fn().mockReturnValue({
        provider: { default: 'openai' },
        model: { default: 'gpt-4' },
        context: { maxTurns: 10 },
        memory: { enabled: false },
        sandbox: { enabled: false },
        skills: { enabled: false },
        plugins: { enabled: false },
      }),
      getConfigDir: vi.fn().mockReturnValue('/tmp/xiaobai-test'),
    },
    provider: {
      chat: vi.fn().mockResolvedValue({ content: 'Hello!', usage: { totalTokens: 10 } }),
      chatStream: vi.fn(),
      updateConfig: vi.fn(),
    },
    tools: {
      registerBatch: vi.fn(),
      getToolDefinitions: vi.fn().mockReturnValue([]),
      execute: vi.fn(),
    },
    sessions: {
      createSession: vi.fn().mockReturnValue('test-session-1'),
      loadMessages: vi.fn().mockResolvedValue([]),
      saveMessages: vi.fn().mockResolvedValue(undefined),
      saveSessionState: vi.fn().mockResolvedValue(undefined),
      loadSessionState: vi.fn().mockResolvedValue(null),
    },
    hooks: {
      emit: vi.fn().mockResolvedValue({ exitCode: 'ok' }),
    },
    memory: {
      getSystemPromptBlock: vi.fn().mockResolvedValue(null),
      flushIfDirty: vi.fn().mockResolvedValue(undefined),
    },
    security: {
      checkPermission: vi.fn().mockResolvedValue(true),
    },
  } as unknown as AgentDeps;
}

describe('XiaobaiAgent', () => {
  let deps: AgentDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('constructs with deps', () => {
    const agent = new XiaobaiAgent(deps);
    expect(agent).toBeInstanceOf(XiaobaiAgent);
  });

  it('getTools returns the tool registry', () => {
    const agent = new XiaobaiAgent(deps);
    expect(agent.getTools()).toBe(deps.tools);
  });

  it('getMemory returns the memory system', () => {
    const agent = new XiaobaiAgent(deps);
    expect(agent.getMemory()).toBe(deps.memory);
  });

  it('getHooks returns the hook system', () => {
    const agent = new XiaobaiAgent(deps);
    expect(agent.getHooks()).toBe(deps.hooks);
  });

  it('getSecurity returns the security manager', () => {
    const agent = new XiaobaiAgent(deps);
    expect(agent.getSecurity()).toBe(deps.security);
  });

  it('getSkills returns undefined when not provided', () => {
    const agent = new XiaobaiAgent(deps);
    expect(agent.getSkills()).toBeUndefined();
  });

  it('getPlugins returns undefined when not provided', () => {
    const agent = new XiaobaiAgent(deps);
    expect(agent.getPlugins()).toBeUndefined();
  });

  it('getDeps returns the deps', () => {
    const agent = new XiaobaiAgent(deps);
    expect(agent.getDeps()).toBe(deps);
  });

  it('getCurrentModel returns configured provider and model', () => {
    const agent = new XiaobaiAgent(deps);
    const model = agent.getCurrentModel();
    expect(model).toEqual({ provider: 'openai', model: 'gpt-4' });
  });

  it('setModel updates provider config', () => {
    const agent = new XiaobaiAgent(deps);
    agent.setModel('anthropic', 'claude-3');
    expect(deps.provider.updateConfig).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-3',
    });
  });

  it('setModel does nothing without arguments', () => {
    const agent = new XiaobaiAgent(deps);
    agent.setModel();
    expect(deps.provider.updateConfig).not.toHaveBeenCalled();
  });

  it('setModel updates only provider', () => {
    const agent = new XiaobaiAgent(deps);
    agent.setModel('google');
    expect(deps.provider.updateConfig).toHaveBeenCalledWith({ provider: 'google' });
  });

  it('setModel updates only model', () => {
    const agent = new XiaobaiAgent(deps);
    agent.setModel(undefined, 'gemini-pro');
    expect(deps.provider.updateConfig).toHaveBeenCalledWith({ model: 'gemini-pro' });
  });

  it('chat yields text events from the loop', async () => {
    const agent = new XiaobaiAgent(deps);
    const events = [];
    for await (const event of agent.chat('Hello')) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'text')).toBe(true);
  });

  it('chat uses provided sessionId', async () => {
    const agent = new XiaobaiAgent(deps);
    const events = [];
    for await (const event of agent.chat('Hello', 'my-session')) {
      events.push(event);
    }
    expect(deps.sessions.loadMessages).toHaveBeenCalledWith('my-session');
  });

  it('chat creates a new session when no sessionId provided', async () => {
    const agent = new XiaobaiAgent(deps);
    const events = [];
    for await (const event of agent.chat('Hello')) {
      events.push(event);
    }
    expect(deps.sessions.createSession).toHaveBeenCalled();
  });

  it('chatSync returns concatenated text', async () => {
    const agent = new XiaobaiAgent(deps);
    const result = await agent.chatSync('Hello');
    expect(typeof result).toBe('string');
  });

  it('destroy does nothing without plugins', async () => {
    const agent = new XiaobaiAgent(deps);
    await agent.destroy();
  });

  it('destroy deactivates plugins when present', async () => {
    const mockPlugins = { deactivateAll: vi.fn().mockResolvedValue(undefined) };
    const depsWithPlugins = { ...deps, plugins: mockPlugins } as unknown as AgentDeps;
    const agent = new XiaobaiAgent(depsWithPlugins);
    await agent.destroy();
    expect(mockPlugins.deactivateAll).toHaveBeenCalled();
  });
});
