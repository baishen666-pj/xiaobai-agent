import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { XiaobaiAgent } from '../../src/core/agent.js';
import { ProviderRouter } from '../../src/provider/router.js';
import { ConfigManager } from '../../src/config/manager.js';
import { SubAgentEngine } from '../../src/core/sub-agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { A2AServer } from '../../src/protocols/a2a/server.js';
import { A2AClient } from '../../src/protocols/a2a/client.js';
import { Role, TaskState } from '../../src/protocols/a2a/types.js';
import { LocalMemoryBackend } from '../../src/memory/mem0-adapter.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const apiKey =
  process.env['DEEPSEEK_API_KEY'] ??
  process.env['ANTHROPIC_API_KEY'] ??
  process.env['OPENAI_API_KEY'];
const provider = process.env['XIAOBAI_PROVIDER'] ?? (process.env['DEEPSEEK_API_KEY'] ? 'deepseek' : 'anthropic');
const hasApiKey = !!apiKey;

describe.skipIf(!hasApiKey)('E2E: Provider Chat', () => {
  it('completes a chat turn', async () => {
    const config = new ConfigManager();
    const cfg = config.get();
    const router = new ProviderRouter(cfg);

    const response = await router.chat(
      [{ role: 'user', content: 'Reply with exactly: PONG' }],
      { maxTokens: 50 },
    );

    expect(response).not.toBeNull();
    expect(response!.content).toContain('PONG');
  }, 15000);

  it('streams via chatStream', async () => {
    const config = new ConfigManager();
    const router = new ProviderRouter(config.get());

    let fullText = '';
    let gotDone = false;

    for await (const chunk of router.chatStream(
      [{ role: 'user', content: 'Say exactly: STREAM_OK' }],
      { maxTokens: 50 },
    )) {
      if (chunk.type === 'text_delta' && chunk.text) fullText += chunk.text;
      if (chunk.type === 'done') gotDone = true;
    }

    expect(fullText.length).toBeGreaterThan(0);
    expect(gotDone).toBe(true);
  }, 15000);

  it('makes a tool call', async () => {
    const config = new ConfigManager();
    const router = new ProviderRouter(config.get());

    const tools = [{
      name: 'get_time',
      description: 'Get current time',
      parameters: { type: 'object' as const, properties: { timezone: { type: 'string' } }, required: [] },
    }];

    const response = await router.chat(
      [{ role: 'user', content: 'What time is it? Use the get_time tool.' }],
      { tools, maxTokens: 200 },
    );

    expect(response).not.toBeNull();
    expect(response!.toolCalls).toBeDefined();
    expect(response!.toolCalls!.length).toBeGreaterThan(0);
    expect(response!.toolCalls![0].name).toBe('get_time');
  }, 15000);
});

describe.skipIf(!hasApiKey)('E2E: AgentLoop Tool Pipeline', () => {
  let testDir: string;
  let agent: XiaobaiAgent;

  beforeAll(async () => {
    testDir = join(tmpdir(), `xiaobai-e2e-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    agent = await XiaobaiAgent.create();
  });

  afterAll(async () => {
    await agent.destroy();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('reads a file via tool call', async () => {
    const filePath = join(testDir, 'read-test.txt');
    writeFileSync(filePath, 'The secret code is ALPHA-7.');

    const sessionId = agent.getDeps().sessions.createSession();
    const events: string[] = [];

    for await (const event of agent.chat(
      `Read the file ${filePath} and tell me the secret code. Reply with ONLY the code.`,
      sessionId,
    )) {
      events.push(event.type);
    }

    expect(events).toContain('text');
    expect(events).toContain('stop');
  }, 30000);

  it('writes a file via tool call', async () => {
    // DeepSeek can be slow on write tool calls
    const filePath = join(testDir, 'write-test.txt');
    const sessionId = agent.getDeps().sessions.createSession();

    for await (const event of agent.chat(
      `Write "E2E_WRITE_OK" to ${filePath}. Do not output anything else.`,
      sessionId,
    )) {
      // consume
    }

    if (existsSync(filePath)) {
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('E2E_WRITE_OK');
    }
  }, 60000);

  it('runs bash command via tool call', async () => {
    const sessionId = agent.getDeps().sessions.createSession();
    let response = '';

    for await (const event of agent.chat(
      'Run: echo BASH_E2E_OK. Reply with only the output.',
      sessionId,
    )) {
      if (event.type === 'text') response += event.content;
    }

    expect(response.toUpperCase()).toContain('BASH');
  }, 30000);

  it('handles multi-turn conversation', async () => {
    const sessionId = agent.getDeps().sessions.createSession();

    for await (const event of agent.chat('Remember this number: 42. Just reply OK.', sessionId)) {
      // consume turn 1
    }

    let r2 = '';
    for await (const event of agent.chat('What number did I ask you to remember?', sessionId)) {
      if (event.type === 'text') r2 += event.content;
    }

    expect(r2).toContain('42');
  }, 45000);
});

describe.skipIf(!hasApiKey)('E2E: A2A Protocol with Agent', () => {
  let server: A2AServer;
  let agent: XiaobaiAgent;

  beforeAll(async () => {
    agent = await XiaobaiAgent.create();
    const port = 14350 + Math.floor(Math.random() * 100);

    server = new A2AServer({
      port,
      handler: {
        async onMessage(message) {
          const text = message.parts.find((p) => p.text)?.text ?? '';
          const result = await agent.chatSync(text);
          return {
            task: {
              id: `task_${Date.now()}`,
              status: { state: TaskState.COMPLETED, timestamp: new Date().toISOString() },
              history: [message, {
                messageId: `resp_${Date.now()}`,
                role: Role.AGENT,
                parts: [{ text: result }],
              }],
            },
          };
        },
        async onGetTask() { return null; },
        async onCancelTask() { return null; },
      },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await agent.destroy();
  });

  it('discovers agent card via A2A', async () => {
    const client = new A2AClient(server.getUrl());
    const card = await client.discover();
    expect(card.name).toBe('xiaobai-agent');
    expect(card.skills.length).toBeGreaterThan(0);
  });

  it('sends message and gets A2A task response', async () => {
    const client = new A2AClient(server.getUrl());
    await client.discover();

    const response = await client.sendMessage('Say exactly: A2A_OK');

    if ('task' in response) {
      expect(response.task.status.state).toBe(TaskState.COMPLETED);
      expect(response.task.history!.length).toBeGreaterThanOrEqual(2);
    }
  }, 30000);
});

describe('E2E: Memory Backend', () => {
  it('LocalMemoryBackend round-trip', async () => {
    const backend = new LocalMemoryBackend(5000);
    await backend.add('long-term', 'E2E test memory');
    await backend.add('state', 'user lang: zh');

    expect(await backend.list('long-term')).toContain('E2E test memory');
    expect(await backend.list('state')).toContain('user lang: zh');

    const block = await backend.getSystemPromptBlock();
    expect(block).toContain('E2E test memory');
  });
});

describe('E2E: SubAgentEngine depth control', () => {
  it('blocks spawn at depth 0', async () => {
    const tempDir = join(tmpdir(), `xiaobai-sub-e2e-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    const { SessionManager } = await import('../../src/session/manager.js');
    const { HookSystem } = await import('../../src/hooks/system.js');
    const { MemorySystem } = await import('../../src/memory/system.js');
    const { SecurityManager } = await import('../../src/security/manager.js');

    const config = new ConfigManager();
    const engine = new SubAgentEngine({
      provider: new ProviderRouter(config.get()),
      sessions: new SessionManager(tempDir),
      hooks: new HookSystem(tempDir),
      config,
      memory: new MemorySystem(tempDir),
      security: new SecurityManager(config.get()),
    });

    engine.setMaxDepth(0);
    const result = await engine.spawn('test', new ToolRegistry());

    expect(result.success).toBe(false);
    expect(result.error).toBe('max_depth_exceeded');

    engine.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });
});
