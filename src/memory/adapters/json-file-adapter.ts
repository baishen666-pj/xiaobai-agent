import fs from 'node:fs';
import path from 'node:path';
import {
  type VectorEntry,
  type SearchResult,
  type VectorStoreAdapter,
  cosineSimilarity,
} from '../vector-store.js';

interface JsonFileData {
  entries: VectorEntry[];
  savedAt: number;
}

export interface JsonFileAdapterOptions {
  filePath: string;
}

export class JsonFileAdapter implements VectorStoreAdapter {
  private filePath: string;
  private cache = new Map<string, VectorEntry>();

  constructor(options: JsonFileAdapterOptions) {
    this.filePath = path.resolve(options.filePath);
  }

  async add(entry: VectorEntry): Promise<void> {
    this.cache.set(entry.id, entry);
  }

  async addBatch(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      this.cache.set(entry.id, entry);
    }
  }

  async get(id: string): Promise<VectorEntry | undefined> {
    return this.cache.get(id);
  }

  async remove(id: string): Promise<boolean> {
    return this.cache.delete(id);
  }

  async search(query: number[], topK: number, minScore: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const entry of this.cache.values()) {
      const score = cosineSimilarity(query, entry.embedding);
      if (score >= minScore) {
        results.push({
          id: entry.id,
          content: entry.content,
          score,
          metadata: entry.metadata,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async count(): Promise<number> {
    return this.cache.size;
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async save(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data: JsonFileData = {
      entries: Array.from(this.cache.values()),
      savedAt: Date.now(),
    };

    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(): Promise<VectorEntry[]> {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const data: JsonFileData = JSON.parse(raw);

    this.cache.clear();
    for (const entry of data.entries) {
      this.cache.set(entry.id, entry);
    }

    return data.entries;
  }
}
