import { describe, it, expect, vi } from 'vitest';
import { MemorySummarizer } from '../../src/memory/summarizer.js';

function createMockProvider(response: string) {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
    chatStream: vi.fn(),
    updateConfig: vi.fn(),
  } as any;
}

describe('MemorySummarizer', () => {
  it('shouldSummarize returns true when above threshold', () => {
    const summarizer = new MemorySummarizer(createMockProvider('summary'), { thresholdPercent: 85 });
    expect(summarizer.shouldSummarize(850, 1000)).toBe(true);
    expect(summarizer.shouldSummarize(849, 1000)).toBe(false);
  });

  it('shouldSummarize returns false when limit is zero', () => {
    const summarizer = new MemorySummarizer(createMockProvider('summary'));
    expect(summarizer.shouldSummarize(100, 0)).toBe(false);
  });

  it('summarizes entries via provider', async () => {
    const provider = createMockProvider('Key info: TypeScript, strong types');
    const summarizer = new MemorySummarizer(provider);

    const result = await summarizer.summarize([
      'TypeScript is a strongly typed language.',
      'It builds on JavaScript.',
    ]);

    expect(result.summary).toBeTruthy();
    expect(result.originalChars).toBeGreaterThan(0);
    expect(result.compressionRatio).toBeGreaterThan(0);
    expect(result.compressionRatio).toBeLessThanOrEqual(1);
  });

  it('returns empty result for empty entries', async () => {
    const summarizer = new MemorySummarizer(createMockProvider(''));
    const result = await summarizer.summarize([]);

    expect(result.summary).toBe('');
    expect(result.originalChars).toBe(0);
    expect(result.compressionRatio).toBe(0);
  });

  it('falls back to simple compression on provider failure', async () => {
    const provider = {
      chat: vi.fn().mockRejectedValue(new Error('Provider down')),
      chatStream: vi.fn(),
      updateConfig: vi.fn(),
    } as any;
    const summarizer = new MemorySummarizer(provider, { maxRetries: 1 });

    const result = await summarizer.summarize([
      'This is a very long entry that has many words in it so it should be compressed by the simple fallback method',
    ]);

    expect(result.summary).toBeTruthy();
    expect(result.summaryChars).toBeLessThanOrEqual(result.originalChars);
  });

  it('summarizeEntries keeps entries within limit', () => {
    const summarizer = new MemorySummarizer(createMockProvider(''));

    const result = summarizer.summarizeEntries(
      ['short', 'medium length', 'a very long entry that takes up space'],
      20,
    );

    expect(result.kept.length).toBeGreaterThan(0);
    const totalChars = result.kept.reduce((s, e) => s + e.length, 0);
    expect(totalChars).toBeLessThanOrEqual(20);
    expect(result.evicted).toBeGreaterThanOrEqual(0);
  });

  it('summarizeEntries keeps all if within limit', () => {
    const summarizer = new MemorySummarizer(createMockProvider(''));

    const result = summarizer.summarizeEntries(['a', 'b', 'c'], 100);

    expect(result.kept).toEqual(['a', 'b', 'c']);
    expect(result.evicted).toBe(0);
  });

  it('summarizeEntries handles empty array', () => {
    const summarizer = new MemorySummarizer(createMockProvider(''));
    const result = summarizer.summarizeEntries([], 100);

    expect(result.kept).toEqual([]);
    expect(result.evicted).toBe(0);
  });

  it('uses custom threshold', () => {
    const summarizer = new MemorySummarizer(createMockProvider(''), { thresholdPercent: 50 });
    expect(summarizer.shouldSummarize(500, 1000)).toBe(true);
    expect(summarizer.shouldSummarize(499, 1000)).toBe(false);
  });
});
