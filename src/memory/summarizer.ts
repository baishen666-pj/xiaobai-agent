import type { ProviderRouter } from '../provider/router.js';

export interface SummarizerConfig {
  thresholdPercent?: number;
  maxRetries?: number;
  systemPrompt?: string;
}

interface SummarizeResult {
  original: string;
  summary: string;
  originalChars: number;
  summaryChars: number;
  compressionRatio: number;
}

export class MemorySummarizer {
  private provider: ProviderRouter;
  private thresholdPercent: number;
  private maxRetries: number;
  private systemPrompt: string;

  constructor(provider: ProviderRouter, config?: SummarizerConfig) {
    this.provider = provider;
    this.thresholdPercent = config?.thresholdPercent ?? 85;
    this.maxRetries = config?.maxRetries ?? 2;
    this.systemPrompt = config?.systemPrompt ?? 'Summarize the following text concisely while preserving all key information. Output only the summary, no preamble.';
  }

  shouldSummarize(used: number, limit: number): boolean {
    if (limit === 0) return false;
    return (used / limit) * 100 >= this.thresholdPercent;
  }

  async summarize(entries: string[]): Promise<SummarizeResult> {
    const original = entries.join('\n');
    const originalChars = original.length;

    if (originalChars === 0) {
      return { original, summary: '', originalChars: 0, summaryChars: 0, compressionRatio: 0 };
    }

    let summary = '';
    let attempts = 0;

    while (attempts < this.maxRetries) {
      try {
        const response = await this.provider.chat(
          [{ role: 'user', content: original }],
          { system: this.systemPrompt },
        );
        summary = response?.content?.trim() ?? '';
        if (summary.length > 0) break;
      } catch (e) {
        console.debug('summarizer: summarize attempt failed, retrying', (e as Error).message);
      }
      attempts++;
    }

    if (!summary) {
      summary = this.simpleCompress(entries);
    }

    return {
      original,
      summary,
      originalChars,
      summaryChars: summary.length,
      compressionRatio: summary.length / originalChars,
    };
  }

  summarizeEntries(entries: string[], maxChars: number): { kept: string[]; evicted: number } {
    if (entries.length === 0) return { kept: [], evicted: 0 };

    const totalChars = entries.reduce((s, e) => s + e.length, 0);
    if (totalChars <= maxChars) return { kept: entries, evicted: 0 };

    const kept: string[] = [];
    let used = 0;
    let evicted = 0;

    for (const entry of entries) {
      if (used + entry.length <= maxChars) {
        kept.push(entry);
        used += entry.length;
      } else {
        evicted++;
      }
    }

    return { kept, evicted };
  }

  private simpleCompress(entries: string[]): string {
    return entries
      .map((entry) => {
        const words = entry.split(/\s+/);
        if (words.length <= 10) return entry;
        return words.slice(0, Math.ceil(words.length * 0.5)).join(' ') + '...';
      })
      .join('\n');
  }
}
