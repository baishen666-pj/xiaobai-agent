import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KnowledgeBase } from '../../src/memory/knowledge-base.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function createMockProvider() {
  return {
    chat: vi.fn().mockImplementation(async (messages: any) => {
      const text = messages[0]?.content ?? '';
      const emb = new Array(4).fill(0);
      for (let i = 0; i < Math.min(text.length, 100); i++) {
        emb[i % 4] += Math.sin(text.charCodeAt(i) * 0.1);
      }
      const norm = Math.sqrt(emb.reduce((s: number, v: number) => s + v * v, 0)) || 1;
      return { content: `[${emb.map((v: number) => v / norm).join(',')}]` };
    }),
    chatStream: vi.fn(),
    updateConfig: vi.fn(),
  } as any;
}

describe('KnowledgeBase', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kb-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns 0 chunks when knowledge dir does not exist', async () => {
    const kb = new KnowledgeBase(createMockProvider(), { knowledgeDir: join(testDir, 'nonexistent') });
    const count = await kb.loadAll();
    expect(count).toBe(0);
    expect(kb.isLoaded()).toBe(true);
  });

  it('loads markdown files from knowledge directory', async () => {
    writeFileSync(join(testDir, 'guide.md'), '# Guide\nThis is a guide about TypeScript.');
    writeFileSync(join(testDir, 'notes.txt'), 'Some notes here.');

    const kb = new KnowledgeBase(createMockProvider(), { knowledgeDir: testDir });
    const count = await kb.loadAll();

    expect(count).toBeGreaterThan(0);
    expect(kb.getDocumentCount()).toBe(2);
  });

  it('skips unsupported file extensions', async () => {
    writeFileSync(join(testDir, 'data.json'), '{"key": "value"}');
    writeFileSync(join(testDir, 'image.png'), 'fake png content');
    writeFileSync(join(testDir, 'readme.md'), 'Read this');

    const kb = new KnowledgeBase(createMockProvider(), { knowledgeDir: testDir, supportedExtensions: ['.md'] });
    await kb.loadAll();

    expect(kb.getDocumentCount()).toBe(1);
  });

  it('queries indexed knowledge', async () => {
    writeFileSync(join(testDir, 'api.md'), 'The API uses REST endpoints at /api/v1.');

    const kb = new KnowledgeBase(createMockProvider(), { knowledgeDir: testDir, rag: { minScore: 0 } });
    await kb.loadAll();

    const result = await kb.query('What API endpoints are available?');
    expect(result.assembledContext).toContain('api');
  });

  it('auto-loads on first query if not loaded', async () => {
    writeFileSync(join(testDir, 'doc.md'), 'Auto load test document');

    const kb = new KnowledgeBase(createMockProvider(), { knowledgeDir: testDir, rag: { minScore: 0 } });
    expect(kb.isLoaded()).toBe(false);

    await kb.query('test');
    expect(kb.isLoaded()).toBe(true);
  });

  it('clears all data', async () => {
    writeFileSync(join(testDir, 'doc.md'), 'Content to clear');

    const kb = new KnowledgeBase(createMockProvider(), { knowledgeDir: testDir });
    await kb.loadAll();
    expect(kb.getDocumentCount()).toBeGreaterThan(0);

    kb.clear();
    expect(kb.getDocumentCount()).toBe(0);
    expect(kb.isLoaded()).toBe(false);
  });

  it('returns correct knowledge dir', () => {
    const kb = new KnowledgeBase(createMockProvider(), { knowledgeDir: testDir });
    expect(kb.getKnowledgeDir()).toBe(testDir);
  });

  it('skips empty files', async () => {
    writeFileSync(join(testDir, 'empty.md'), '');
    writeFileSync(join(testDir, 'spaces.txt'), '   ');

    const kb = new KnowledgeBase(createMockProvider(), { knowledgeDir: testDir });
    const count = await kb.loadAll();
    expect(count).toBe(0);
  });

  it('loads files from subdirectories', async () => {
    const subDir = join(testDir, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'nested.md'), 'Nested content');

    const kb = new KnowledgeBase(createMockProvider(), { knowledgeDir: testDir });
    const count = await kb.loadAll();

    expect(count).toBeGreaterThan(0);
    expect(kb.getDocumentCount()).toBe(1);
  });
});
