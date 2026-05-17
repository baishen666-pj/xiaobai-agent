import type { VectorEntry, SearchResult, VectorStoreAdapter } from '../vector-store.js';

export interface QdrantAdapterOptions {
  baseUrl?: string;
  collection: string;
}

export class QdrantAdapter implements VectorStoreAdapter {
  private baseUrl: string;
  private collection: string;

  constructor(options: QdrantAdapterOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:6333').replace(/\/$/, '');
    this.collection = options.collection;
  }

  private async ensureCollection(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: 'GET',
    });
    if (res.ok) return;

    await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors: { size: 1536, distance: 'Cosine' } }),
    });
  }

  async add(entry: VectorEntry): Promise<void> {
    await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [{
          id: entry.id,
          vector: entry.embedding,
          payload: { content: entry.content, metadata: entry.metadata ?? {} },
        }],
      }),
    });
    if (!res.ok) throw new Error(`Qdrant add failed: ${res.status} ${await res.text()}`);
  }

  async addBatch(entries: VectorEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: entries.map((e) => ({
          id: e.id,
          vector: e.embedding,
          payload: { content: e.content, metadata: e.metadata ?? {} },
        })),
      }),
    });
    if (!res.ok) throw new Error(`Qdrant addBatch failed: ${res.status} ${await res.text()}`);
  }

  async get(id: string): Promise<VectorEntry | undefined> {
    await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return undefined;
    const data = await res.json() as { result: { vector: number[]; payload: { content: string; metadata: Record<string, unknown> } } };
    return {
      id,
      content: data.result.payload.content,
      embedding: data.result.vector,
      metadata: data.result.payload.metadata,
    };
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: [id] }),
    });
    return res.ok;
  }

  async search(query: number[], topK: number, minScore: number): Promise<SearchResult[]> {
    await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector: query,
        limit: topK,
        score_threshold: minScore,
        with_payload: true,
      }),
    });
    if (!res.ok) throw new Error(`Qdrant search failed: ${res.status} ${await res.text()}`);

    const data = await res.json() as {
      result: Array<{ id: string; score: number; payload: { content: string; metadata: Record<string, unknown> } }>;
    };

    return data.result.map((point) => ({
      id: String(point.id),
      content: point.payload.content,
      score: point.score,
      metadata: point.payload.metadata,
    }));
  }

  async count(): Promise<number> {
    await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: 'GET',
    });
    if (!res.ok) throw new Error(`Qdrant count failed: ${res.status}`);
    const data = await res.json() as { result: { points_count: number } };
    return data.result.points_count;
  }

  async clear(): Promise<void> {
    await fetch(`${this.baseUrl}/collections/${this.collection}`, { method: 'DELETE' });
    await this.ensureCollection();
  }

  async save(): Promise<void> {
    // Qdrant auto-persists
  }

  async load(): Promise<VectorEntry[]> {
    await this.ensureCollection();
    const count = await this.count();
    if (count === 0) return [];

    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: count, with_payload: true, with_vector: true }),
    });
    if (!res.ok) throw new Error(`Qdrant load failed: ${res.status}`);

    const data = await res.json() as {
      result: { points: Array<{ id: string; vector: number[]; payload: { content: string; metadata: Record<string, unknown> } }> };
    };

    return data.result.points.map((point) => ({
      id: String(point.id),
      content: point.payload.content,
      embedding: point.vector,
      metadata: point.payload.metadata,
    }));
  }
}
