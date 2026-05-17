import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { ProviderRouter } from '../provider/router.js';
import { RAGEngine, type RAGDocument, type RAGContext } from './rag.js';

export interface KnowledgeBaseConfig {
  knowledgeDir?: string;
  supportedExtensions?: string[];
  rag?: {
    topK?: number;
    minScore?: number;
    chunkSize?: number;
    chunkOverlap?: number;
  };
}

export class KnowledgeBase {
  private engine: RAGEngine;
  private knowledgeDir: string;
  private supportedExtensions: string[];
  private loaded = false;

  constructor(provider: ProviderRouter, config?: KnowledgeBaseConfig) {
    this.knowledgeDir = config?.knowledgeDir ?? join(process.cwd(), '.xiaobai', 'knowledge');
    this.supportedExtensions = config?.supportedExtensions ?? ['.md', '.txt', '.json'];
    this.engine = new RAGEngine(provider, config?.rag);
  }

  async loadAll(): Promise<number> {
    if (!existsSync(this.knowledgeDir)) {
      this.loaded = true;
      return 0;
    }

    const docs = this.scanDirectory(this.knowledgeDir);
    const count = await this.engine.indexBatch(docs);
    this.loaded = true;
    return count;
  }

  async query(question: string): Promise<RAGContext> {
    if (!this.loaded) {
      await this.loadAll();
    }
    return this.engine.retrieve(question);
  }

  getDocumentCount(): number {
    return this.engine.getDocumentCount();
  }

  getChunkCount(): number {
    return this.engine.getChunkCount();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getKnowledgeDir(): string {
    return this.knowledgeDir;
  }

  clear(): void {
    this.engine.clear();
    this.loaded = false;
  }

  private scanDirectory(dir: string): RAGDocument[] {
    const docs: RAGDocument[] = [];

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          docs.push(...this.scanDirectory(fullPath));
          continue;
        }

        const ext = extname(entry.name);
        if (!this.supportedExtensions.includes(ext)) continue;

        try {
          const content = readFileSync(fullPath, 'utf-8');
          if (content.trim().length === 0) continue;

          const relativePath = fullPath.replace(this.knowledgeDir, '').replace(/^[/\\]/, '');

          docs.push({
            id: `kb_${relativePath.replace(/[/\\]/g, '_')}`,
            content,
            source: relativePath,
            metadata: {
              extension: ext,
              fileName: entry.name,
            },
          });
        } catch (e) {
          console.debug('knowledge-base: Skip unreadable file', (e as Error).message);
        }
      }
    } catch (e) {
      console.debug('knowledge-base: Skip unreadable directory', (e as Error).message);
    }

    return docs;
  }
}
