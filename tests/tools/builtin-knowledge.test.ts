import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  knowledgeSearchTool,
  knowledgeIndexTool,
  knowledgeStatusTool,
} from '../../src/tools/builtin-knowledge.js';
import { getBuiltinTools } from '../../src/tools/builtin.js';
import { ConfigManager } from '../../src/config/manager.js';
import { SecurityManager } from '../../src/security/manager.js';
import { SandboxManager } from '../../src/sandbox/manager.js';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let testDir: string;

function makeMockKB(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn().mockResolvedValue({
      query: 'test query',
      results: [
        { content: 'result content', score: 0.95, source: 'doc.md' },
      ],
      assembledContext: 'assembled context text',
    }),
    getDocumentCount: vi.fn().mockReturnValue(5),
    getChunkCount: vi.fn().mockReturnValue(42),
    isLoaded: vi.fn().mockReturnValue(true),
    getKnowledgeDir: vi.fn().mockReturnValue('/path/to/knowledge'),
    ...overrides,
  } as any;
}

beforeEach(() => {
  testDir = join(tmpdir(), `xiaobai-knowledge-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// knowledge_search
// ---------------------------------------------------------------------------

describe('knowledge_search', () => {
  it('returns results from knowledge base', async () => {
    const kb = makeMockKB();
    const tool = knowledgeSearchTool(kb);
    const result = await tool.execute({ query: 'how to test' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('assembled context text');
    expect(result.metadata?.resultCount).toBe(1);
    expect(kb.query).toHaveBeenCalledWith('how to test');
  });

  it('returns error when no knowledge base provided', async () => {
    const tool = knowledgeSearchTool(undefined);
    const result = await tool.execute({ query: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('no_knowledge');
    expect(result.output).toBe('Knowledge base not available');
  });

  it('returns message when no results found', async () => {
    const kb = makeMockKB({
      query: vi.fn().mockResolvedValue({
        query: 'obscure topic',
        results: [],
        assembledContext: '',
      }),
    });
    const tool = knowledgeSearchTool(kb);
    const result = await tool.execute({ query: 'obscure topic' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('No relevant documents found in the knowledge base');
    expect(result.metadata).toBeUndefined();
  });

  it('returns error when query parameter is missing', async () => {
    const kb = makeMockKB();
    const tool = knowledgeSearchTool(kb);
    const result = await tool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_query');
    expect(result.output).toBe('query parameter is required');
  });

  it('returns error when query parameter is empty string', async () => {
    const kb = makeMockKB();
    const tool = knowledgeSearchTool(kb);
    const result = await tool.execute({ query: '' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_query');
  });

  it('returns error when query parameter is not a string', async () => {
    const kb = makeMockKB();
    const tool = knowledgeSearchTool(kb);
    const result = await tool.execute({ query: 123 });

    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_query');
  });

  it('has correct tool definition', () => {
    const tool = knowledgeSearchTool(makeMockKB());
    expect(tool.definition.name).toBe('knowledge_search');
    expect(tool.definition.parameters.required).toContain('query');
  });
});

// ---------------------------------------------------------------------------
// knowledge_index
// ---------------------------------------------------------------------------

describe('knowledge_index', () => {
  it('indexes content with content param', async () => {
    const mockIndexDocument = vi.fn().mockResolvedValue(3);
    const kb = makeMockKB({
      engine: { indexDocument: mockIndexDocument },
    });

    vi.doMock('../../src/memory/rag.js', () => ({
      RAGEngine: vi.fn(),
    }));

    const tool = knowledgeIndexTool(kb);
    const result = await tool.execute({
      content: 'Some text to index',
      source: 'test-source',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Indexed 3 chunk(s)');
    expect(result.output).toContain('test-source');
    expect(result.metadata?.chunkCount).toBe(3);
    expect(result.metadata?.docId).toMatch(/^manual_/);
    expect(mockIndexDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Some text to index',
        source: 'test-source',
      }),
    );

    vi.doUnmock('../../src/memory/rag.js');
  });

  it('returns error when no knowledge base provided', async () => {
    const tool = knowledgeIndexTool(undefined);
    const result = await tool.execute({ content: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('no_knowledge');
    expect(result.output).toBe('Knowledge base not available');
  });

  it('returns error when neither content nor path provided', async () => {
    const kb = makeMockKB();
    const tool = knowledgeIndexTool(kb);
    const result = await tool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('no_content');
    expect(result.output).toContain('No content provided');
  });

  it('returns error when content is only whitespace', async () => {
    const kb = makeMockKB();
    const tool = knowledgeIndexTool(kb);
    const result = await tool.execute({ content: '   ' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('no_content');
  });

  it('uses "direct" as default source when source not provided', async () => {
    const mockIndexDocument = vi.fn().mockResolvedValue(1);
    const kb = makeMockKB({
      engine: { indexDocument: mockIndexDocument },
    });

    vi.doMock('../../src/memory/rag.js', () => ({
      RAGEngine: vi.fn(),
    }));

    const tool = knowledgeIndexTool(kb);
    const result = await tool.execute({ content: 'hello world' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('source: direct');
    expect(mockIndexDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'direct',
      }),
    );

    vi.doUnmock('../../src/memory/rag.js');
  });

  it('indexes content from file path', async () => {
    const mockIndexDocument = vi.fn().mockResolvedValue(2);
    const kb = makeMockKB({
      engine: { indexDocument: mockIndexDocument },
    });
    const filePath = join(testDir, 'doc.txt');
    require('node:fs').writeFileSync(filePath, 'File content to index');

    vi.doMock('../../src/memory/rag.js', () => ({
      RAGEngine: vi.fn(),
    }));

    const tool = knowledgeIndexTool(kb);
    const result = await tool.execute({ path: filePath });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Indexed 2 chunk(s)');
    expect(mockIndexDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'File content to index',
        source: filePath,
      }),
    );

    vi.doUnmock('../../src/memory/rag.js');
  });

  it('has correct tool definition', () => {
    const tool = knowledgeIndexTool(makeMockKB());
    expect(tool.definition.name).toBe('knowledge_index');
    expect(tool.definition.parameters.required).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// knowledge_status
// ---------------------------------------------------------------------------

describe('knowledge_status', () => {
  it('returns knowledge base status', async () => {
    const kb = makeMockKB();
    const tool = knowledgeStatusTool(kb);
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.loaded).toBe(true);
    expect(parsed.documents).toBe(5);
    expect(parsed.chunks).toBe(42);
    expect(parsed.knowledgeDir).toBe('/path/to/knowledge');
    expect(kb.getDocumentCount).toHaveBeenCalled();
    expect(kb.getChunkCount).toHaveBeenCalled();
    expect(kb.isLoaded).toHaveBeenCalled();
    expect(kb.getKnowledgeDir).toHaveBeenCalled();
  });

  it('returns error when no knowledge base provided', async () => {
    const tool = knowledgeStatusTool(undefined);
    const result = await tool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toBe('no_knowledge');
    expect(result.output).toBe('Knowledge base not available');
  });

  it('has correct tool definition', () => {
    const tool = knowledgeStatusTool(makeMockKB());
    expect(tool.definition.name).toBe('knowledge_status');
    expect(tool.definition.parameters.properties).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getBuiltinTools integration
// ---------------------------------------------------------------------------

describe('getBuiltinTools integration', () => {
  it('includes knowledge tools in the tool list', () => {
    const config = ConfigManager.getDefault();
    const security = new SecurityManager(config);
    const sandbox = new SandboxManager(config.sandbox);
    const tools = getBuiltinTools({ security, config, sandbox } as any);
    const names = tools.map((t) => t.definition.name);

    expect(names).toContain('knowledge_search');
    expect(names).toContain('knowledge_index');
    expect(names).toContain('knowledge_status');
  });

  it('knowledge tools have proper definitions', () => {
    const tools = getBuiltinTools();
    const search = tools.find((t) => t.definition.name === 'knowledge_search')!;
    const index = tools.find((t) => t.definition.name === 'knowledge_index')!;
    const status = tools.find((t) => t.definition.name === 'knowledge_status')!;

    expect(search).toBeDefined();
    expect(index).toBeDefined();
    expect(status).toBeDefined();

    expect(search.definition.description.length).toBeGreaterThan(0);
    expect(index.definition.description.length).toBeGreaterThan(0);
    expect(status.definition.description.length).toBeGreaterThan(0);
  });

  it('knowledge tools return error without KB in context', async () => {
    const tools = getBuiltinTools();
    const search = tools.find((t) => t.definition.name === 'knowledge_search')!;
    const index = tools.find((t) => t.definition.name === 'knowledge_index')!;
    const status = tools.find((t) => t.definition.name === 'knowledge_status')!;

    const searchResult = await search.execute({ query: 'test' });
    expect(searchResult.success).toBe(false);
    expect(searchResult.error).toBe('no_knowledge');

    const indexResult = await index.execute({ content: 'test' });
    expect(indexResult.success).toBe(false);
    expect(indexResult.error).toBe('no_knowledge');

    const statusResult = await status.execute({});
    expect(statusResult.success).toBe(false);
    expect(statusResult.error).toBe('no_knowledge');
  });
});
