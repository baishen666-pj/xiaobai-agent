import type { VectorEntry, SearchResult, VectorStoreAdapter } from '../vector-store.js';

export interface ChromaDBAdapterOptions {
  baseUrl?: string;
  collection: string;
}

export class ChromaDBAdapter implements VectorStoreAdapter {
  private baseUrl: string;
  private collection: string;
  private collectionId: string | null = null;

  constructor(options: ChromaDBAdapterOptions) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:8000').replace(/\/$/, '');
    this.collection = options.collection;
  }

  private async ensureCollection(): Promise<string> {
    if (this.collectionId) return this.collectionId;

    const res = await fetch(`${this.baseUrl}/api/v1/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.collection, get_or_create: true }),
    });

    if (!res.ok) throw new Error(`ChromaDB create collection failed: ${res.status}`);
    const data = await res.json() as { id: string };
    this.collectionId = data.id;
    return this.collectionId;
  }

  async add(entry: VectorEntry): Promise<void> {
    const colId = await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/api/v1/collections/${colId}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: [entry.id],
        embeddings: [entry.embedding],
        documents: [entry.content],
        metadatas: [entry.metadata ?? {}],
      }),
    });
    if (!res.ok) throw new Error(`ChromaDB add failed: ${res.status}`);
  }

  async addBatch(entries: VectorEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const colId = await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/api/v1/collections/${colId}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: entries.map((e) => e.id),
        embeddings: entries.map((e) => e.embedding),
        documents: entries.map((e) => e.content),
        metadatas: entries.map((e) => e.metadata ?? {}),
      }),
    });
    if (!res.ok) throw new Error(`ChromaDB addBatch failed: ${res.status}`);
  }

  async get(id: string): Promise<VectorEntry | undefined> {
    const colId = await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/api/v1/collections/${colId}/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], include: ['embeddings', 'documents', 'metadatas'] }),
    });
    if (!res.ok) throw new Error(`ChromaDB get failed: ${res.status}`);
    const data = await res.json() as { ids: string[]; embeddings: number[][]; documents: string[]; metadatas: Record<string, unknown>[] };
    if (data.ids.length === 0) return undefined;
    return {
      id: data.ids[0],
      content: data.documents[0],
      embedding: data.embeddings[0],
      metadata: data.metadatas[0],
    };
  }

  async remove(id: string): Promise<boolean> {
    const colId = await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/api/v1/collections/${colId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
    return res.ok;
  }

  async search(query: number[], topK: number, minScore: number): Promise<SearchResult[]> {
    const colId = await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/api/v1/collections/${colId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query_embeddings: [query],
        n_results: topK,
        include: ['documents', 'distances', 'metadatas'],
      }),
    });
    if (!res.ok) throw new Error(`ChromaDB search failed: ${res.status}`);

    const data = await res.json() as {
      ids: string[][];
      documents: string[][];
      distances: number[][];
      metadatas: Record<string, unknown>[][];
    };

    const results: SearchResult[] = [];
    const ids = data.ids[0] ?? [];
    const docs = data.documents[0] ?? [];
    const distances = data.distances[0] ?? [];
    const metas = data.metadatas[0] ?? [];

    for (let i = 0; i < ids.length; i++) {
      const score = 1 - distances[i];
      if (score >= minScore) {
        results.push({
          id: ids[i],
          content: docs[i],
          score,
          metadata: metas[i],
        });
      }
    }
    return results;
  }

  async count(): Promise<number> {
    const colId = await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/api/v1/collections/${colId}/count`);
    if (!res.ok) throw new Error(`ChromaDB count failed: ${res.status}`);
    return (await res.json()) as number;
  }

  async clear(): Promise<void> {
    if (this.collectionId) {
      await fetch(`${this.baseUrl}/api/v1/collections/${this.collectionId}/delete`, { method: 'DELETE' });
      this.collectionId = null;
    }
    await this.ensureCollection();
  }

  async save(): Promise<void> {
    // ChromaDB auto-persists
  }

  async load(): Promise<VectorEntry[]> {
    const colId = await this.ensureCollection();
    const res = await fetch(`${this.baseUrl}/api/v1/collections/${colId}/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ include: ['embeddings', 'documents', 'metadatas'] }),
    });
    if (!res.ok) throw new Error(`ChromaDB load failed: ${res.status}`);
    const data = await res.json() as { ids: string[]; embeddings: number[][]; documents: string[]; metadatas: Record<string, unknown>[] };
    return data.ids.map((id, i) => ({
      id,
      content: data.documents[i],
      embedding: data.embeddings[i],
      metadata: data.metadatas[i],
    }));
  }
}
