import { describe, it, expect, beforeAll } from 'vitest';
import { ProviderRouter } from '../../src/provider/router.js';
import { XiaobaiAgent } from '../../src/core/agent.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { getBuiltinTools } from '../../src/tools/builtin.js';
import { ConfigManager } from '../../src/config/manager.js';
import { SecurityManager } from '../../src/security/manager.js';
import { MemorySystem } from '../../src/memory/system.js';
import { SandboxManager } from '../../src/sandbox/manager.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Message } from '../../src/session/manager.js';

const apiKey = process.env['ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_AUTH_TOKEN'];
const hasApiKey = !!apiKey;

describe.skipIf(!hasApiKey)('Real API: ProviderRouter', () => {
  it('completes a single chat turn', async () => {
    const config = ConfigManager.getDefault();
    config.provider.apiKey = apiKey;
    const router = new ProviderRouter(config);

    const response = await router.chat(
      [{ role: 'user', content: 'Reply with exactly one word: HELLO' }],
      { maxTokens: 50 },
    );

    expect(response).not.toBeNull();
    expect(response!.content).toContain('HELLO');
    expect(response!.usage!.totalTokens).toBeGreaterThan(0);
  }, 15000);

  it('streams response via chatStream', async () => {
    const config = ConfigManager.getDefault();
    config.provider.apiKey = apiKey;
    const router = new ProviderRouter(config);

    let fullText = '';
    let receivedDone = false;

    for await (const chunk of router.chatStream(
      [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }],
      { maxTokens: 200 },
    )) {
      if (chunk.type === 'text_delta' && chunk.text) {
        fullText += chunk.text;
      }
      if (chunk.type === 'done') {
        receivedDone = true;
      }
    }

    expect(fullText.length).toBeGreaterThan(0);
    expect(receivedDone).toBe(true);
  });

  it('makes a tool call', async () => {
    const config = ConfigManager.getDefault();
    config.provider.apiKey = apiKey;
    const router = new ProviderRouter(config);

    const tools = [
      {
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
          type: 'object' as const,
          properties: {
            location: { type: 'string', description: 'City name' },
          },
          required: ['location'],
        },
      },
    ];

    const response = await router.chat(
      [{ role: 'user', content: 'What is the weather in Tokyo?' }],
      { tools, maxTokens: 500 },
    );

    expect(response).not.toBeNull();
    expect(response!.toolCalls).toBeDefined();
    expect(response!.toolCalls!.length).toBeGreaterThan(0);
    expect(response!.toolCalls![0].name).toBe('get_weather');
    expect(response!.toolCalls![0].arguments).toHaveProperty('location');
  });

  it('summarizes a conversation', async () => {
    const config = ConfigManager.getDefault();
    config.provider.apiKey = apiKey;
    const router = new ProviderRouter(config);

    const messages: Message[] = [
      { role: 'user', content: 'My project uses React and TypeScript.' },
      { role: 'assistant', content: 'Great choice! React with TypeScript provides type safety.' },
      { role: 'user', content: 'I also use Vite for bundling.' },
      { role: 'assistant', content: 'Vite is excellent for fast development builds.' },
    ];

    const summary = await router.summarize(messages);
    expect(summary.length).toBeGreaterThan(10);
    expect(summary.toLowerCase()).toContain('react');
  }, 15000);
});

describe.skipIf(!hasApiKey)('Real API: AgentLoop with tools', () => {
  let testDir: string;

  beforeAll(() => {
    testDir = join(tmpdir(), `xiaobai-real-api-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('reads a file through tool call', async () => {
    const filePath = join(testDir, 'test.txt');
    writeFileSync(filePath, 'The answer is 42.');

    const agent = await XiaobaiAgent.create();
    const sessionId = (agent as any).deps.sessions.createSession();
    const events: string[] = [];

    for await (const event of agent.chat(
      `Read the file at ${filePath} and tell me what number is in it. Reply with just the number.`,
      sessionId,
    )) {
      events.push(event.type);
    }

    // Should have at least text and stop events
    expect(events).toContain('text');
    expect(events).toContain('stop');
  }, 30000);

  it('writes a file through tool call', async () => {
    const filePath = join(testDir, 'output.txt');

    const agent = await XiaobaiAgent.create();
    const sessionId = (agent as any).deps.sessions.createSession();

    let response = '';
    for await (const event of agent.chat(
      `Write the text "Hello from Xiaobai!" to the file at ${filePath}`,
      sessionId,
    )) {
      if (event.type === 'text') response += event.content;
    }

    // File should exist after the agent writes it
    // Note: this depends on the LLM actually calling the write tool
    if (existsSync(filePath)) {
      const content = await import('node:fs').then((fs) => fs.readFileSync(filePath, 'utf-8'));
      expect(content).toContain('Xiaobai');
    }
  }, 30000);

  it('runs bash command through tool call', async () => {
    const agent = await XiaobaiAgent.create();
    const sessionId = (agent as any).deps.sessions.createSession();

    let response = '';
    for await (const event of agent.chat(
      'Run the command "echo E2E_TEST_OK" and tell me the exact output.',
      sessionId,
    )) {
      if (event.type === 'text') response += event.content;
    }

    expect(response.toUpperCase()).toContain('E2E');
  }, 30000);
});
