import { describe, it, expect } from 'vitest';
import { PricingTable } from '../../src/core/pricing.js';
import { TokenTracker, type TokenUsageSummary } from '../../src/core/token-tracker.js';

function createTracker(): TokenTracker {
  const pricingTable = new PricingTable();
  return new TokenTracker(pricingTable);
}

describe('TokenTracker', () => {
  it('should start with empty records', () => {
    const tracker = createTracker();
    expect(tracker.getRecords()).toEqual([]);
    expect(tracker.getSummary().totalTokens).toBe(0);
    expect(tracker.getSummary().totalCost).toBe(0);
  });

  it('should record a single usage', () => {
    const tracker = createTracker();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const records = tracker.getRecords();
    expect(records.length).toBe(1);
    expect(records[0].provider).toBe('anthropic');
    expect(records[0].model).toBe('claude-sonnet-4-6');
    expect(records[0].promptTokens).toBe(1000);
    expect(records[0].completionTokens).toBe(500);
    expect(records[0].totalTokens).toBe(1500);
    expect(records[0].cost).toBeCloseTo(0.0105, 4);
    expect(records[0].isEstimated).toBe(false);
    expect(records[0].timestamp).toBeGreaterThan(0);
  });

  it('should accumulate multiple records', () => {
    const tracker = createTracker();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    tracker.recordUsage('openai', 'gpt-4o', {
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
    });

    expect(tracker.getRecords().length).toBe(2);
    const summary = tracker.getSummary();
    expect(summary.totalPromptTokens).toBe(3000);
    expect(summary.totalCompletionTokens).toBe(1500);
    expect(summary.totalTokens).toBe(4500);
  });

  it('should group by provider in summary', () => {
    const tracker = createTracker();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    tracker.recordUsage('anthropic', 'claude-haiku-4-5', {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
    });
    tracker.recordUsage('openai', 'gpt-4o', {
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
    });

    const summary = tracker.getSummary();
    expect(summary.byProvider.size).toBe(2);
    expect(summary.byProvider.get('anthropic')!.tokens).toBe(2200);
    expect(summary.byProvider.get('openai')!.tokens).toBe(3000);
  });

  it('should group by provider/model in summary', () => {
    const tracker = createTracker();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    tracker.recordUsage('anthropic', 'claude-haiku-4-5', {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
    });

    const summary = tracker.getSummary();
    expect(summary.byModel.size).toBe(2);
    expect(summary.byModel.get('anthropic/claude-sonnet-4-6')!.tokens).toBe(1500);
    expect(summary.byModel.get('anthropic/claude-haiku-4-5')!.tokens).toBe(700);
  });

  it('should accumulate cost by provider', () => {
    const tracker = createTracker();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 1000000,
      completionTokens: 0,
      totalTokens: 1000000,
    });
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 0,
      completionTokens: 1000000,
      totalTokens: 1000000,
    });

    const summary = tracker.getSummary();
    const providerSummary = summary.byProvider.get('anthropic')!;
    expect(providerSummary.cost).toBeCloseTo(18, 2);
    expect(summary.totalCost).toBeCloseTo(18, 2);
  });

  it('should reset all records', () => {
    const tracker = createTracker();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    expect(tracker.getRecords().length).toBe(1);

    tracker.reset();
    expect(tracker.getRecords()).toEqual([]);
    expect(tracker.getSummary().totalTokens).toBe(0);
    expect(tracker.getSummary().totalCost).toBe(0);
  });

  it('should return copies of records, not references', () => {
    const tracker = createTracker();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const records1 = tracker.getRecords();
    const records2 = tracker.getRecords();
    expect(records1).not.toBe(records2);
    expect(records1).toEqual(records2);
  });

  it('should handle zero tokens', () => {
    const tracker = createTracker();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });

    const summary = tracker.getSummary();
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalCost).toBe(0);
  });

  it('should handle free provider (Ollama)', () => {
    const tracker = createTracker();
    tracker.recordUsage('ollama', 'llama3', {
      promptTokens: 10000,
      completionTokens: 5000,
      totalTokens: 15000,
    });

    const records = tracker.getRecords();
    expect(records[0].cost).toBe(0);

    const summary = tracker.getSummary();
    expect(summary.totalTokens).toBe(15000);
    expect(summary.totalCost).toBe(0);
  });

  it('should handle unknown model with default pricing', () => {
    const tracker = createTracker();
    tracker.recordUsage('some-provider', 'unknown-model', {
      promptTokens: 1000000,
      completionTokens: 1000000,
      totalTokens: 2000000,
    });

    const records = tracker.getRecords();
    expect(records[0].cost).toBeCloseTo(4, 2);
  });

  it('should format empty summary', () => {
    const tracker = createTracker();
    const formatted = tracker.formatSummary();
    expect(formatted).toBe('No token usage recorded.');
  });

  it('should format summary with records', () => {
    const tracker = createTracker();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    const formatted = tracker.formatSummary();
    expect(formatted).toContain('Tokens: 1.5k');
    expect(formatted).toContain('Cost: $');
    expect(formatted).toContain('Input: 1.0k');
    expect(formatted).toContain('Output: 500');
    expect(formatted).toContain('By Model:');
    expect(formatted).toContain('anthropic/claude-sonnet-4-6');
  });

  it('should handle mixed multi-provider scenario', () => {
    const tracker = createTracker();

    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
    });
    tracker.recordUsage('openai', 'gpt-4o-mini', {
      promptTokens: 10000,
      completionTokens: 5000,
      totalTokens: 15000,
    });
    tracker.recordUsage('deepseek', 'deepseek-chat', {
      promptTokens: 2000,
      completionTokens: 1000,
      totalTokens: 3000,
    });
    tracker.recordUsage('ollama', 'mistral', {
      promptTokens: 8000,
      completionTokens: 4000,
      totalTokens: 12000,
    });

    const summary = tracker.getSummary();
    expect(summary.totalTokens).toBe(30700);
    expect(summary.totalPromptTokens).toBe(20500);
    expect(summary.totalCompletionTokens).toBe(10200);
    expect(summary.byProvider.size).toBe(4);
    expect(summary.byModel.size).toBe(4);
    expect(summary.totalCost).toBeGreaterThan(0);

    const ollamaData = summary.byProvider.get('ollama')!;
    expect(ollamaData.cost).toBe(0);
    expect(ollamaData.tokens).toBe(12000);
  });

  it('should include timestamp in records', () => {
    const tracker = createTracker();
    const before = Date.now();
    tracker.recordUsage('anthropic', 'claude-sonnet-4-6', {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    const after = Date.now();

    const records = tracker.getRecords();
    expect(records[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(records[0].timestamp).toBeLessThanOrEqual(after);
  });
});
