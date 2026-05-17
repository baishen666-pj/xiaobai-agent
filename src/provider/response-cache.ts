import { createHash } from 'node:crypto';
import type { ProviderResponse } from './types.js';

interface CacheEntry {
  response: ProviderResponse;
  expiresAt: number;
}

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private defaultTtlMs: number;

  constructor(options?: { maxSize?: number; ttlMs?: number }) {
    this.maxSize = options?.maxSize ?? 100;
    this.defaultTtlMs = options?.ttlMs ?? 300_000;
  }

  private computeKey(provider: string, model: string, messages: unknown[], temperature?: number): string {
    const data = JSON.stringify({ provider, model, messages, temperature });
    return createHash('sha256').update(data).digest('hex').slice(0, 32);
  }

  get(provider: string, model: string, messages: unknown[], temperature?: number): ProviderResponse | null {
    const key = this.computeKey(provider, model, messages, temperature);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.response;
  }

  set(provider: string, model: string, messages: unknown[], response: ProviderResponse, ttlMs?: number): void {
    const key = this.computeKey(provider, model, messages);
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }
}
