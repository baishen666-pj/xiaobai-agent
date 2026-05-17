import type { ProviderRouter } from '../provider/router.js';

export interface EmbeddingOptions {
  model?: string;
  dimensions?: number;
}

export interface EmbeddingCacheAdapter {
  get(key: string): Promise<number[] | undefined>;
  set(key: string, value: number[]): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

export interface EmbeddingServiceOptions {
  model?: string;
  cacheAdapter?: EmbeddingCacheAdapter;
}

export class EmbeddingService {
  private provider: ProviderRouter;
  private defaultModel: string;
  private cache = new Map<string, number[]>();
  private cacheAdapter?: EmbeddingCacheAdapter;

  constructor(provider: ProviderRouter, modelOrOptions?: string | EmbeddingServiceOptions) {
    this.provider = provider;
    if (typeof modelOrOptions === 'string') {
      this.defaultModel = modelOrOptions;
    } else if (modelOrOptions && typeof modelOrOptions === 'object') {
      this.defaultModel = modelOrOptions.model ?? 'text-embedding-3-small';
      this.cacheAdapter = modelOrOptions.cacheAdapter;
    } else {
      this.defaultModel = 'text-embedding-3-small';
    }
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    const cacheKey = `${options?.model ?? this.defaultModel}:${text}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Check persistent adapter on in-memory cache miss
    if (this.cacheAdapter) {
      const persisted = await this.cacheAdapter.get(cacheKey);
      if (persisted) {
        this.cache.set(cacheKey, persisted);
        return persisted;
      }
    }

    const embedding = await this.callProvider(text, options);
    this.cache.set(cacheKey, embedding);

    // Write through to persistent adapter
    if (this.cacheAdapter) {
      await this.cacheAdapter.set(cacheKey, embedding);
    }

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
    if (this.cacheAdapter) {
      // Fire-and-forget async clear to keep this method synchronous
      this.cacheAdapter.clear().catch(() => {});
    }
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
