import type { PricingTable, TokenCost } from './pricing.js';

export interface TokenUsageRecord {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  isEstimated: boolean;
  timestamp: number;
}

export interface ProviderSummary {
  tokens: number;
  cost: number;
}

export interface ModelSummary {
  tokens: number;
  cost: number;
}

export interface TokenUsageSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCost: number;
  byProvider: Map<string, ProviderSummary>;
  byModel: Map<string, ModelSummary>;
}

export class TokenTracker {
  private records: TokenUsageRecord[];
  private pricingTable: PricingTable;

  constructor(pricingTable: PricingTable) {
    this.records = [];
    this.pricingTable = pricingTable;
  }

  recordUsage(
    provider: string,
    model: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  ): void {
    const cost = this.pricingTable.calculateCost(provider, model, usage.promptTokens, usage.completionTokens);

    this.records.push({
      provider,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      cost: cost.totalCost,
      isEstimated: cost.isEstimated,
      timestamp: Date.now(),
    });
  }

  getSummary(): TokenUsageSummary {
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let totalCost = 0;
    const byProvider = new Map<string, ProviderSummary>();
    const byModel = new Map<string, ModelSummary>();

    for (const record of this.records) {
      totalPromptTokens += record.promptTokens;
      totalCompletionTokens += record.completionTokens;
      totalTokens += record.totalTokens;
      totalCost += record.cost;

      const providerKey = record.provider;
      const prevProvider = byProvider.get(providerKey);
      byProvider.set(providerKey, {
        tokens: (prevProvider?.tokens ?? 0) + record.totalTokens,
        cost: (prevProvider?.cost ?? 0) + record.cost,
      });

      const modelKey = `${record.provider}/${record.model}`;
      const prevModel = byModel.get(modelKey);
      byModel.set(modelKey, {
        tokens: (prevModel?.tokens ?? 0) + record.totalTokens,
        cost: (prevModel?.cost ?? 0) + record.cost,
      });
    }

    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCost,
      byProvider,
      byModel,
    };
  }

  getRecords(): TokenUsageRecord[] {
    return [...this.records];
  }

  reset(): void {
    this.records = [];
  }

  formatSummary(): string {
    const summary = this.getSummary();

    if (this.records.length === 0) {
      return 'No token usage recorded.';
    }

    const hasEstimated = this.records.some((r) => r.isEstimated);
    const lines: string[] = [];
    lines.push(`Tokens: ${formatTokenCount(summary.totalTokens)} | Cost: $${summary.totalCost.toFixed(4)}${hasEstimated ? ' (estimated)' : ''}`);
    lines.push(`  Input: ${formatTokenCount(summary.totalPromptTokens)} | Output: ${formatTokenCount(summary.totalCompletionTokens)}`);

    if (summary.byModel.size > 0) {
      lines.push('');
      lines.push('  By Model:');
      for (const [model, data] of summary.byModel) {
        lines.push(`    ${model}: ${formatTokenCount(data.tokens)} tokens, $${data.cost.toFixed(4)}`);
      }
    }

    if (hasEstimated) {
      lines.push('');
      lines.push('  * Cost for unknown models uses default rates — actual cost may differ');
    }

    return lines.join('\n');
  }
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
