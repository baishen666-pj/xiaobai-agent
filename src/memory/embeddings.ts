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
    const dimensions = options?.dimensions;

    try {
      const response = await this.provider.embed(text, model);
      let embedding = response.embedding;

      if (dimensions && dimensions < embedding.length) {
        embedding = embedding.slice(0, dimensions);
      }

      return embedding;
    } catch (e) {
      console.debug('embeddings: provider call failed, falling back to keyword embedding', (e as Error).message);
    }

    return this.keywordFallback(text, dimensions ?? 384);
  }

  /**
   * Deterministic keyword-based fallback that preserves some semantic similarity.
   * Texts sharing common words will produce vectors with higher cosine similarity.
   */
  private keywordFallback(text: string, dimensions: number): number[] {
    const result = new Array(dimensions).fill(0);
    const normalized = text.toLowerCase().trim();
    if (normalized.length === 0) return result;

    // Simple hash-based approach: hash each word and accumulate into fixed buckets
    const words = normalized.split(/\s+/);
    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
      }
      // Map hash to multiple dimensions for better distribution
      for (let d = 0; d < 3; d++) {
        const idx = Math.abs(hash + d * 7919) % dimensions;
        result[idx] += 1.0;
      }
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
