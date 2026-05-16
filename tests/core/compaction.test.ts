import { describe, it, expect, vi } from 'vitest';
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

/** Provider that always returns null response (simulates empty model response) */
class NullResponseProvider {
  async chat(_messages: Message[], _options?: ChatOptions): Promise<ProviderResponse | null> {
    return null;
  }
}

/** Provider that throws (simulates API failure), then succeeds on retry */
class FailingProvider {
  private callCount = 0;
  async chat(messages: Message[], options?: ChatOptions): Promise<ProviderResponse | null> {
    this.callCount++;
    throw new Error(`API error on call ${this.callCount}`);
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

// ── Branch coverage: generateSummary role mapping ──

describe('CompactionEngine generateSummary role branches', () => {
  it('covers system role prefix', async () => {
    const chatSpy = vi.fn().mockResolvedValue({
      content: 'summary',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const provider = { chat: chatSpy };
    const engine = new CompactionEngine(provider as any, { keepLastN: 1 });

    const msgs: Message[] = [
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'User question' },
    ];
    const result = await engine.compact(msgs);

    // The chat call for summary should include "SYSTEM" prefix
    const summaryCallArgs = chatSpy.mock.calls[0][0] as Message[];
    const userContentInSummary = summaryCallArgs[1].content;
    expect(userContentInSummary).toContain('[SYSTEM]');
  });

  it('covers user role prefix', async () => {
    const chatSpy = vi.fn().mockResolvedValue({
      content: 'summary',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const provider = { chat: chatSpy };
    const engine = new CompactionEngine(provider as any, { keepLastN: 1 });

    const msgs: Message[] = [
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Reply' },
    ];
    await engine.compact(msgs);

    const summaryCallArgs = chatSpy.mock.calls[0][0] as Message[];
    expect(summaryCallArgs[1].content).toContain('[USER]');
  });

  it('covers assistant role prefix', async () => {
    const chatSpy = vi.fn().mockResolvedValue({
      content: 'summary',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const provider = { chat: chatSpy };
    const engine = new CompactionEngine(provider as any, { keepLastN: 1 });

    const msgs: Message[] = [
      { role: 'assistant', content: 'I will help' },
      { role: 'user', content: 'Thanks' },
    ];
    await engine.compact(msgs);

    const summaryCallArgs = chatSpy.mock.calls[0][0] as Message[];
    expect(summaryCallArgs[1].content).toContain('[ASSISTANT]');
  });

  it('covers tool_result role prefix (default TOOL)', async () => {
    const chatSpy = vi.fn().mockResolvedValue({
      content: 'summary',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const provider = { chat: chatSpy };
    const engine = new CompactionEngine(provider as any, { keepLastN: 1 });

    const msgs: Message[] = [
      { role: 'tool_result', content: 'tool output here', toolCallId: 'tc_1' },
      { role: 'user', content: 'Next question' },
    ];
    await engine.compact(msgs);

    const summaryCallArgs = chatSpy.mock.calls[0][0] as Message[];
    const userContent = summaryCallArgs[1].content;
    // tool_result role maps to prefix "TOOL", but toolCallId adds the suffix
    expect(userContent).toContain('[TOOL (tool: tc_1)]');
  });

  it('covers toolCallId suffix in summary generation', async () => {
    const chatSpy = vi.fn().mockResolvedValue({
      content: 'summary',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const provider = { chat: chatSpy };
    const engine = new CompactionEngine(provider as any, { keepLastN: 1 });

    const msgs: Message[] = [
      { role: 'tool_result', content: 'result text', toolCallId: 'call_abc_123' },
      { role: 'user', content: 'Next' },
    ];
    await engine.compact(msgs);

    const summaryCallArgs = chatSpy.mock.calls[0][0] as Message[];
    expect(summaryCallArgs[1].content).toContain('tool: call_abc_123');
  });

  it('does not include tool suffix when toolCallId is absent', async () => {
    const chatSpy = vi.fn().mockResolvedValue({
      content: 'summary',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const provider = { chat: chatSpy };
    const engine = new CompactionEngine(provider as any, { keepLastN: 1 });

    const msgs: Message[] = [
      { role: 'user', content: 'No tool call here' },
      { role: 'assistant', content: 'Reply' },
    ];
    await engine.compact(msgs);

    const summaryCallArgs = chatSpy.mock.calls[0][0] as Message[];
    expect(summaryCallArgs[1].content).not.toContain('tool:');
  });
});

// ── Branch coverage: fallbackSummary (provider throws or returns null) ──

describe('CompactionEngine fallbackSummary', () => {
  it('uses fallbackSummary when provider throws', async () => {
    const engine = new CompactionEngine(new FailingProvider() as any, { keepLastN: 2 });
    const msgs: Message[] = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer with tool call' },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Second answer' },
    ];
    const result = await engine.compact(msgs);

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('Auto-summary');
    // keepLastN=2 means oldMessages = first 2, so fallbackSummary sees 2 messages
    expect(result.messages[0].content).toContain('2 messages');
    expect(result.messages[0].content).toContain('1 user turns');
    // The assistant message "First answer with tool call" contains "tool"
    expect(result.messages[0].content).toContain('1 tool interactions');
  });

  it('counts zero tool interactions when no assistant mentions tool', async () => {
    const engine = new CompactionEngine(new FailingProvider() as any, { keepLastN: 2 });
    const msgs: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Bye' },
      { role: 'assistant', content: 'Goodbye' },
    ];
    const result = await engine.compact(msgs);

    // keepLastN=2 => oldMessages = first 2: user + assistant (no "tool" mention)
    expect(result.messages[0].content).toContain('0 tool interactions');
  });

  it('uses fallbackSummary when provider returns null', async () => {
    const engine = new CompactionEngine(new NullResponseProvider() as any, { keepLastN: 2 });
    const msgs: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Response using a tool invocation' },
      { role: 'user', content: 'Follow-up' },
      { role: 'assistant', content: 'Done' },
    ];
    const result = await engine.compact(msgs);

    // When provider returns null, the nullish coalescing path returns 'Context summary unavailable'
    expect(result.messages[0].content).toContain('Context summary unavailable');
  });
});

// ── Branch coverage: shouldCompact edge cases ──

describe('CompactionEngine shouldCompact edge cases', () => {
  it('returns false when totalTokens is 0 and messages are few', () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      maxContextTokens: 100_000,
      compressionThreshold: 0.5,
    });
    const msgs: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    // totalTokens=0 triggers estimateTokens path; 2 short messages -> very few tokens
    expect(engine.shouldCompact(msgs, 0, 0)).toBe(false);
  });

  it('returns false when lastCompactTokens is close to totalTokens', () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      maxContextTokens: 1000,
      compressionThreshold: 0.5,
    });
    // threshold = 500; totalTokens - lastCompactTokens = 10 - 9 = 1 < 500
    expect(engine.shouldCompact([], 10, 9)).toBe(false);
  });

  it('returns true when difference exceeds threshold', () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      maxContextTokens: 1000,
      compressionThreshold: 0.5,
    });
    // threshold = 500; totalTokens - lastCompactTokens = 1000 - 0 = 1000 > 500
    expect(engine.shouldCompact([], 1000, 0)).toBe(true);
  });

  it('estimates tokens from messages when totalTokens is 0', () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      maxContextTokens: 50,
      compressionThreshold: 0.5,
    });
    // 400 chars / 4 = 100 tokens; threshold = 25; 100 > 25 => true
    const msgs: Message[] = [
      { role: 'user', content: 'a'.repeat(200) },
      { role: 'assistant', content: 'b'.repeat(200) },
    ];
    expect(engine.shouldCompact(msgs, 0, 0)).toBe(true);
  });
});

// ── estimateTokens with toolCalls ──

describe('CompactionEngine estimateTokens with tool calls', () => {
  it('includes toolCalls in token estimation', () => {
    const engine = new CompactionEngine(new MockProvider() as any);
    const msgs: Message[] = [
      {
        role: 'assistant',
        content: 'I will read a file',
        toolCalls: [
          { id: 'call_1', name: 'read', arguments: { file_path: '/some/path' } },
          { id: 'call_2', name: 'grep', arguments: { pattern: 'test' } },
        ],
      },
    ];
    const tokens = engine.estimateTokens(msgs);
    // content = 17 chars, tc1 name=4, args JSON=~24, tc2 name=4, args JSON=~17
    // Total roughly 17 + 4 + 24 + 4 + 17 = 66 chars, ceil(66/4) = 17
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(50);
  });

  it('handles message with toolCallId in token estimation', () => {
    const engine = new CompactionEngine(new MockProvider() as any);
    const msgs: Message[] = [
      {
        role: 'tool_result',
        content: 'file contents here',
        toolCallId: 'call_abc_12345',
      },
    ];
    const tokens = engine.estimateTokens(msgs);
    // content = 18, toolCallId = 14, total = 32, ceil(32/4) = 8
    expect(tokens).toBe(8);
  });

  it('handles empty messages array', () => {
    const engine = new CompactionEngine(new MockProvider() as any);
    expect(engine.estimateTokens([])).toBe(0);
  });

  it('handles toolCalls with undefined name', () => {
    const engine = new CompactionEngine(new MockProvider() as any);
    const msgs: Message[] = [
      {
        role: 'assistant',
        content: 'test',
        toolCalls: [
          { id: 'call_1', name: undefined as any, arguments: { a: 1 } },
        ],
      },
    ];
    const tokens = engine.estimateTokens(msgs);
    // content=4, name=0 (undefined), args JSON=7 = 11, ceil(11/4)=3
    expect(tokens).toBe(3);
  });
});

// ── savedTokens and edge cases in compact ──

describe('CompactionEngine compact edge cases', () => {
  it('savedTokens is never negative (Math.max guard)', async () => {
    const engine = new CompactionEngine(new MockProvider() as any, {
      keepLastN: 1,
    });
    // With just 2 messages, the summary could be longer than old messages
    const msgs: Message[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    const result = await engine.compact(msgs);
    expect(result.savedTokens).toBeGreaterThanOrEqual(0);
  });

  it('truncates message content at 500 chars in summary generation', async () => {
    const chatSpy = vi.fn().mockResolvedValue({
      content: 'summary',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const provider = { chat: chatSpy };
    const engine = new CompactionEngine(provider as any, { keepLastN: 1 });

    const longContent = 'x'.repeat(1000);
    const msgs: Message[] = [
      { role: 'user', content: longContent },
      { role: 'assistant', content: 'reply' },
    ];
    await engine.compact(msgs);

    const summaryCallArgs = chatSpy.mock.calls[0][0] as Message[];
    const userContent = summaryCallArgs[1].content;
    // Each line should have at most 500 chars from slice
    const lines = userContent.split('\n');
    for (const line of lines) {
      // The line format is [PREFIX]: content -- the content part after "]: " is sliced to 500
      const colonIndex = line.indexOf(']: ');
      if (colonIndex >= 0) {
        const contentPart = line.substring(colonIndex + 3);
        expect(contentPart.length).toBeLessThanOrEqual(500);
      }
    }
  });

  it('uses default config when no config is provided', async () => {
    const engine = new CompactionEngine(new MockProvider() as any);
    // Default keepLastN = 20, so 10 messages should not be compacted
    const msgs = makeMessages(10);
    const result = await engine.compact(msgs);
    expect(result.messages.length).toBe(10);
    expect(result.summary).toBe('');
  });

  it('uses custom summaryMaxTokens in chat options', async () => {
    const chatSpy = vi.fn().mockResolvedValue({
      content: 'summary',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const provider = { chat: chatSpy };
    const engine = new CompactionEngine(provider as any, {
      keepLastN: 1,
      summaryMaxTokens: 500,
    });

    const msgs: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    await engine.compact(msgs);

    const chatOptions = chatSpy.mock.calls[0][1] as ChatOptions;
    expect(chatOptions.maxTokens).toBe(500);
  });
});
