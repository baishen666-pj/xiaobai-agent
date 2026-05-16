export interface RateLimiterConfig {
  maxTokens: number;
  refillRate: number;
  perProvider: boolean;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxTokens: 60,
  refillRate: 1,
  perProvider: true,
};

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private buckets = new Map<string, Bucket>();

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getBucket(key: string): Bucket {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        tokens: this.config.maxTokens,
        lastRefill: Date.now(),
      });
    }
    return this.buckets.get(key)!;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.config.refillRate;
    bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  acquire(providerName: string, tokens = 1): boolean {
    const key = this.config.perProvider ? providerName : '_global';
    const bucket = this.getBucket(key);
    this.refill(bucket);

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return true;
    }
    return false;
  }

  async acquireOrWait(providerName: string, tokens = 1, timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.acquire(providerName, tokens)) return true;
      const key = this.config.perProvider ? providerName : '_global';
      const bucket = this.getBucket(key);
      const deficit = tokens - bucket.tokens;
      const waitMs = Math.ceil((deficit / this.config.refillRate) * 1000);
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 100)));
    }
    return false;
  }

  getAvailableTokens(providerName: string): number {
    const key = this.config.perProvider ? providerName : '_global';
    const bucket = this.getBucket(key);
    this.refill(bucket);
    return bucket.tokens;
  }

  reset(providerName?: string): void {
    if (providerName) {
      this.buckets.delete(providerName);
    } else {
      this.buckets.clear();
    }
  }
}
