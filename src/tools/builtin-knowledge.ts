import type { Tool, ToolResult } from './registry.js';
import type { KnowledgeBase } from '../memory/knowledge-base.js';

export function knowledgeSearchTool(kb?: KnowledgeBase): Tool {
  return {
    definition: {
      name: 'knowledge_search',
      description: 'Search the indexed knowledge base for relevant information and documentation',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant knowledge',
          },
          topK: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
          },
        },
        required: ['query'],
      },
    },
    async execute(args): Promise<ToolResult> {
      if (!kb) {
        return { output: 'Knowledge base not available', success: false, error: 'no_knowledge' };
      }

      const { query } = args as { query: string; topK?: number };
      if (!query || typeof query !== 'string') {
        return { output: 'query parameter is required', success: false, error: 'missing_query' };
      }

      const context = await kb.query(query);
      if (!context.assembledContext || context.results.length === 0) {
        return { output: 'No relevant documents found in the knowledge base', success: true };
      }

      return {
        output: context.assembledContext,
        success: true,
        metadata: { resultCount: context.results.length },
      };
    },
  };
}

export function knowledgeIndexTool(kb?: KnowledgeBase): Tool {
  return {
    definition: {
      name: 'knowledge_index',
      description: 'Index content into the knowledge base for later retrieval',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Text content to index',
          },
          source: {
            type: 'string',
            description: 'Source identifier for the content',
          },
          path: {
            type: 'string',
            description: 'File path to read and index',
          },
        },
        required: [],
      },
    },
    async execute(args): Promise<ToolResult> {
      if (!kb) {
        return { output: 'Knowledge base not available', success: false, error: 'no_knowledge' };
      }

      const { content, source, path } = args as { content?: string; source?: string; path?: string };

      let text = content;
      let src = source ?? 'direct';

      if (path) {
        const { readFileSync } = await import('node:fs');
        text = readFileSync(path, 'utf-8');
        src = source ?? path;
      }

      if (!text || text.trim().length === 0) {
        return {
          output: 'No content provided. Specify either content or path parameter.',
          success: false,
          error: 'no_content',
        };
      }

      const { RAGEngine } = await import('../memory/rag.js');
      const engine = (kb as unknown as { engine: InstanceType<typeof RAGEngine> }).engine;
      const docId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const chunkCount = await engine.indexDocument({
        id: docId,
        content: text,
        source: src,
      });

      return {
        output: `Indexed ${chunkCount} chunk(s) from source: ${src}`,
        success: true,
        metadata: { chunkCount, docId },
      };
    },
  };
}

export function knowledgeStatusTool(kb?: KnowledgeBase): Tool {
  return {
    definition: {
      name: 'knowledge_status',
      description: 'Get the current status of the knowledge base (document count, chunk count)',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    async execute(): Promise<ToolResult> {
      if (!kb) {
        return { output: 'Knowledge base not available', success: false, error: 'no_knowledge' };
      }

      const docs = kb.getDocumentCount();
      const chunks = kb.getChunkCount();
      const loaded = kb.isLoaded();
      const dir = kb.getKnowledgeDir();

      return {
        output: JSON.stringify({
          loaded,
          knowledgeDir: dir,
          documents: docs,
          chunks,
        }),
        success: true,
      };
    },
  };
}
