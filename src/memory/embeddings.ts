import type { ProviderRouter } from '../provider/router.js';

export interface EmbeddingOptions {
  model?: string;
  dimensions?: number;
}

export class EmbeddingService {
  private provider: ProviderRouter;
  private defaultModel: string;
  private cache = new Map<string, number[]>();

  constructor(provider: ProviderRouter, model?: string) {
    this.provider = provider;
    this.defaultModel = model ?? 'text-embedding-3-small';
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    const cacheKey = `${options?.model ?? this.defaultModel}:${text}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const embedding = await this.callProvider(text, options);
    this.cache.set(cacheKey, embedding);
    return embedding;
  }

  async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text, options));
    }
    return results;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  private async callProvider(text: string, options?: EmbeddingOptions): Promise<number[]> {
    const model = options?.model ?? this.defaultModel;

    try {
      const response = await this.provider.chat(
        [
          {
            role: 'user',
            content: `Generate an embedding for the following text. Return ONLY a JSON array of ${options?.dimensions ?? 1536} floating-point numbers, nothing else:\n\n${text}`,
          },
        ],
        { system: 'You are an embedding generator. Return only a JSON array of numbers.' },
      );

      const content = response?.content ?? '';
      const match = content.match(/\[[\d\s,.\-e]+\]/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch {
      // Fallback to simple hash-based embedding
    }

    return this.fallbackEmbed(text, options?.dimensions ?? 1536);
  }

  private fallbackEmbed(text: string, dimensions: number): number[] {
    const result = new Array(dimensions).fill(0);
    const normalized = text.toLowerCase().trim();
    if (normalized.length === 0) return result;

    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i);
      const idx = i % dimensions;
      result[idx] += Math.sin(charCode * (i + 1) * 0.001);
    }

    const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < result.length; i++) {
        result[i] /= norm;
      }
    }

    return result;
  }
}
