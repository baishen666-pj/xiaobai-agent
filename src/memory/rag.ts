import { VectorStore, type SearchResult, type VectorStoreAdapter } from './vector-store.js';
import { EmbeddingService } from './embeddings.js';
import type { ProviderRouter } from '../provider/router.js';

export interface RAGConfig {
  topK?: number;
  minScore?: number;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface RAGDocument {
  id: string;
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface RAGContext {
  query: string;
  results: SearchResult[];
  assembledContext: string;
}

interface Chunk {
  id: string;
  content: string;
  documentId: string;
  index: number;
}

export class RAGEngine {
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService;
  private persistence?: VectorStoreAdapter;
  private chunks = new Map<string, Chunk>();
  private documents = new Map<string, RAGDocument>();
  private config: Required<RAGConfig>;
  private chunkIdCounter = 0;

  constructor(provider: ProviderRouter, config?: RAGConfig, persistence?: VectorStoreAdapter) {
    this.config = {
      topK: config?.topK ?? 5,
      minScore: config?.minScore ?? 0.7,
      chunkSize: config?.chunkSize ?? 500,
      chunkOverlap: config?.chunkOverlap ?? 50,
    };
    this.vectorStore = new VectorStore();
    this.embeddingService = new EmbeddingService(provider);
    this.persistence = persistence;
  }

  async indexDocument(doc: RAGDocument): Promise<number> {
    this.documents.set(doc.id, doc);
    const chunks = this.chunkText(doc.content, doc.id);
    let indexed = 0;

    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);

      const embedding = await this.embeddingService.embed(chunk.content);
      const entry = {
        id: chunk.id,
        content: chunk.content,
        embedding,
        metadata: {
          documentId: doc.id,
          chunkIndex: chunk.index,
          source: doc.source,
          ...doc.metadata,
        },
      };
      this.vectorStore.add(entry);

      if (this.persistence) {
        await this.persistence.add(entry);
      }
      indexed++;
    }

    if (this.persistence) {
      await this.persistence.save();
    }

    return indexed;
  }

  async indexBatch(docs: RAGDocument[]): Promise<number> {
    let total = 0;
    for (const doc of docs) {
      total += await this.indexDocument(doc);
    }
    return total;
  }

  async retrieve(query: string): Promise<RAGContext> {
    const queryEmbedding = await this.embeddingService.embed(query);
    const results = this.vectorStore.search(queryEmbedding, this.config.topK, this.config.minScore);

    const assembledContext = results
      .map((r, i) => {
        const source = r.metadata?.source ?? r.metadata?.documentId ?? 'unknown';
        return `[${i + 1}] (source: ${source}, score: ${r.score.toFixed(3)})\n${r.content}`;
      })
      .join('\n\n');

    return {
      query,
      results,
      assembledContext,
    };
  }

  removeDocument(docId: string): boolean {
    const removed = this.documents.delete(docId);
    const chunksToRemove: string[] = [];
    for (const [chunkId, chunk] of this.chunks) {
      if (chunk.documentId === docId) {
        chunksToRemove.push(chunkId);
      }
    }
    for (const chunkId of chunksToRemove) {
      this.chunks.delete(chunkId);
      this.vectorStore.remove(chunkId);
      if (this.persistence) {
        this.persistence.remove(chunkId);
      }
    }
    return removed;
  }

  getDocument(id: string): RAGDocument | undefined {
    return this.documents.get(id);
  }

  getDocumentCount(): number {
    return this.documents.size;
  }

  getChunkCount(): number {
    return this.chunks.size;
  }

  clear(): void {
    this.vectorStore.clear();
    this.chunks.clear();
    this.documents.clear();
    this.embeddingService.clearCache();
    if (this.persistence) {
      // Fire-and-forget async clear to keep this method synchronous
      this.persistence.clear().catch(() => {});
    }
  }

  async loadPersisted(): Promise<number> {
    if (!this.persistence) return 0;

    const entries = await this.persistence.load();
    let loaded = 0;
    for (const entry of entries) {
      this.vectorStore.add(entry);
      loaded++;
    }
    return loaded;
  }

  private chunkText(text: string, documentId: string): Chunk[] {
    const chunks: Chunk[] = [];
    const { chunkSize, chunkOverlap } = this.config;

    if (text.length <= chunkSize) {
      chunks.push({
        id: `chunk_${++this.chunkIdCounter}`,
        content: text,
        documentId,
        index: 0,
      });
      return chunks;
    }

    let start = 0;
    let index = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const content = text.slice(start, end);

      chunks.push({
        id: `chunk_${++this.chunkIdCounter}`,
        content,
        documentId,
        index,
      });

      start += chunkSize - chunkOverlap;
      index++;
      if (start >= text.length) break;
      if (end === text.length) break;
    }

    return chunks;
  }
}
