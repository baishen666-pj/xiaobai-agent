import { describe, it, expect } from 'vitest';
import { CompactionEngine } from '../../src/core/compaction.js';
import type { Message } from '../../src/session/manager.js';
import type { ProviderRouter, ChatOptions, ProviderResponse } from '../../src/provider/router.js';

class MockProvider {
  async chat(messages: Message[], options?: ChatOptions): Promise<ProviderResponse | null> {
    const lastMsg = messages[messages.length - 1];
    return {
      content: `Summary of ${messages.length} messages. Last: ${lastMsg.content.slice(0, 50)}`,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };
  }
}

function makeMessages(count: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1}: ${'x'.repeat(100)}`,
    });
  }
  return msgs;
}

describe('CompactionEngine', () => {
  it('should not compact when under threshold', () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      maxContextTokens: 100_000,
      compressionThreshold: 0.5,
    });
    const msgs = makeMessages(5);
    expect(engine.shouldCompact(msgs, 1000, 0)).toBe(false);
  });

  it('should compact when over threshold', () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      maxContextTokens: 1000,
      compressionThreshold: 0.5,
    });
    const msgs = makeMessages(50);
    expect(engine.shouldCompact(msgs, 0, 0)).toBe(true);
  });

  it('compacts messages preserving last N', async () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      keepLastN: 5,
    });
    const msgs = makeMessages(20);
    const result = await engine.compact(msgs);

    expect(result.originalCount).toBe(20);
    expect(result.messages.length).toBe(6); // 1 summary + 5 kept
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('Summary');
    expect(result.messages[1].content).toContain('Message 16');
    expect(result.messages[5].content).toContain('Message 20');
  });

  it('does not compact when messages <= keepLastN', async () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      keepLastN: 20,
    });
    const msgs = makeMessages(10);
    const result = await engine.compact(msgs);

    expect(result.originalCount).toBe(10);
    expect(result.messages.length).toBe(10);
    expect(result.summary).toBe('');
    expect(result.savedTokens).toBe(0);
  });

  it('estimates tokens from messages', () => {
    const engine = new CompactionEngine(new MockProvider() as any);
    const msgs: Message[] = [
      { role: 'user', content: 'a'.repeat(400) },
      { role: 'assistant', content: 'b'.repeat(800) },
    ];
    const tokens = engine.estimateTokens(msgs);
    expect(tokens).toBe(300); // (400 + 800) / 4
  });

  it('handles tool_result messages in compaction', async () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      keepLastN: 3,
    });
    const msgs: Message[] = [
      { role: 'user', content: 'first user message' },
      { role: 'assistant', content: 'first response' },
      { role: 'tool_result', content: 'tool output', toolCallId: 'call_1' },
      { role: 'user', content: 'second user message' },
      { role: 'assistant', content: 'second response' },
    ];
    const result = await engine.compact(msgs);

    expect(result.messages.length).toBe(4); // 1 summary + 3 kept
    expect(result.messages[1].content).toContain('tool output');
  });
});
