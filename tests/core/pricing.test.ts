import { describe, it, expect } from 'vitest';
import { PricingTable, type PricingEntry } from '../../src/core/pricing.js';

describe('PricingTable', () => {
  it('should load builtin pricing data', () => {
    const table = new PricingTable();
    const models = table.listModels();
    expect(models.length).toBeGreaterThan(0);
  });

  it('should return price for known Anthropic models', () => {
    const table = new PricingTable();
    const price = table.getPrice('anthropic', 'claude-sonnet-4-6');
    expect(price).not.toBeNull();
    expect(price!.input).toBe(3);
    expect(price!.output).toBe(15);
  });

  it('should return price for known OpenAI models', () => {
    const table = new PricingTable();
    const price = table.getPrice('openai', 'gpt-4o');
    expect(price).not.toBeNull();
    expect(price!.input).toBe(2.5);
    expect(price!.output).toBe(10);
  });

  it('should return price for known Google models', () => {
    const table = new PricingTable();
    const price = table.getPrice('google', 'gemini-2.0-flash');
    expect(price).not.toBeNull();
    expect(price!.input).toBe(0.1);
    expect(price!.output).toBe(0.4);
  });

  it('should return price for known DeepSeek models', () => {
    const table = new PricingTable();
    const price = table.getPrice('deepseek', 'deepseek-chat');
    expect(price).not.toBeNull();
    expect(price!.input).toBe(0.27);
    expect(price!.output).toBe(1.1);
  });

  it('should return price for known Qwen models', () => {
    const table = new PricingTable();
    const price = table.getPrice('qwen', 'qwen-max');
    expect(price).not.toBeNull();
    expect(price!.input).toBe(1.6);
    expect(price!.output).toBe(6.4);
  });

  it('should return price for known Groq models', () => {
    const table = new PricingTable();
    const price = table.getPrice('groq', 'llama-3.3-70b');
    expect(price).not.toBeNull();
    expect(price!.input).toBe(0.59);
    expect(price!.output).toBe(0.79);
  });

  it('should return free pricing for Ollama models via wildcard', () => {
    const table = new PricingTable();
    const price = table.getPrice('ollama', 'llama3');
    expect(price).not.toBeNull();
    expect(price!.input).toBe(0);
    expect(price!.output).toBe(0);
  });

  it('should return null for unknown provider/model', () => {
    const table = new PricingTable();
    const price = table.getPrice('unknown-provider', 'unknown-model');
    expect(price).toBeNull();
  });

  it('should calculate cost correctly for known model', () => {
    const table = new PricingTable();
    const cost = table.calculateCost('anthropic', 'claude-sonnet-4-6', 1000, 500);
    expect(cost.inputCost).toBeCloseTo(0.003, 6);
    expect(cost.outputCost).toBeCloseTo(0.0075, 6);
    expect(cost.totalCost).toBeCloseTo(0.0105, 6);
    expect(cost.currency).toBe('USD');
    expect(cost.isEstimated).toBe(false);
  });

  it('should calculate cost with default pricing for unknown model', () => {
    const table = new PricingTable();
    const cost = table.calculateCost('unknown', 'unknown-model', 1000, 500);
    expect(cost.inputCost).toBeCloseTo(0.001, 6);
    expect(cost.outputCost).toBeCloseTo(0.0015, 6);
    expect(cost.totalCost).toBeCloseTo(0.0025, 6);
    expect(cost.isEstimated).toBe(true);
  });

  it('should calculate zero cost for Ollama', () => {
    const table = new PricingTable();
    const cost = table.calculateCost('ollama', 'llama3', 10000, 5000);
    expect(cost.inputCost).toBe(0);
    expect(cost.outputCost).toBe(0);
    expect(cost.totalCost).toBe(0);
  });

  it('should calculate zero cost for zero tokens', () => {
    const table = new PricingTable();
    const cost = table.calculateCost('anthropic', 'claude-sonnet-4-6', 0, 0);
    expect(cost.inputCost).toBe(0);
    expect(cost.outputCost).toBe(0);
    expect(cost.totalCost).toBe(0);
  });

  it('should allow adding custom pricing', () => {
    const table = new PricingTable();
    const customEntry: PricingEntry = {
      provider: 'custom',
      model: 'my-model',
      inputPricePer1M: 5,
      outputPricePer1M: 20,
    };
    table.addPricing(customEntry);

    const price = table.getPrice('custom', 'my-model');
    expect(price).not.toBeNull();
    expect(price!.input).toBe(5);
    expect(price!.output).toBe(20);
  });

  it('should override existing pricing with addPricing', () => {
    const table = new PricingTable();
    const original = table.getPrice('anthropic', 'claude-sonnet-4-6');
    expect(original!.input).toBe(3);

    table.addPricing({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputPricePer1M: 99,
      outputPricePer1M: 99,
    });

    const updated = table.getPrice('anthropic', 'claude-sonnet-4-6');
    expect(updated!.input).toBe(99);
    expect(updated!.output).toBe(99);
  });

  it('should handle large token counts', () => {
    const table = new PricingTable();
    const cost = table.calculateCost('openai', 'gpt-4o', 1_000_000, 1_000_000);
    expect(cost.inputCost).toBe(2.5);
    expect(cost.outputCost).toBe(10);
    expect(cost.totalCost).toBe(12.5);
  });

  it('should list all builtin models', () => {
    const table = new PricingTable();
    const models = table.listModels();

    const providers = new Set(models.map((m) => m.provider));
    expect(providers.has('anthropic')).toBe(true);
    expect(providers.has('openai')).toBe(true);
    expect(providers.has('google')).toBe(true);
    expect(providers.has('deepseek')).toBe(true);
    expect(providers.has('qwen')).toBe(true);
    expect(providers.has('groq')).toBe(true);
    expect(providers.has('ollama')).toBe(true);
  });
});
