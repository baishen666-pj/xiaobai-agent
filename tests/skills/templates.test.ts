import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'skills', 'templates');

const BUILTIN_NAMES = ['code-review', 'test-gen', 'refactor', 'doc-writer', 'security-audit', 'debug', 'explain'];
const VALID_CATEGORIES = ['coding', 'analysis', 'writing', 'planning', 'review', 'devops', 'general'];

function loadTemplate(name: string): { frontmatter: Record<string, string>; body: string } {
  const path = join(templatesDir, name, 'SKILL.md');
  const content = readFileSync(path, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Invalid template: ${name}`);

  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const fmMatch = line.match(/^(\w+):\s*(.+)$/);
    if (fmMatch) fm[fmMatch[1]] = fmMatch[2].trim();
  }

  return { frontmatter: fm, body: match[2].trim() };
}

describe('Skill Templates', () => {
  for (const name of BUILTIN_NAMES) {
    describe(name, () => {
      it('has a SKILL.md file', () => {
        expect(existsSync(join(templatesDir, name, 'SKILL.md'))).toBe(true);
      });

      it('has valid YAML frontmatter', () => {
        const { frontmatter } = loadTemplate(name);
        expect(frontmatter.name).toBe(name);
        expect(frontmatter.description).toBeTruthy();
        expect(frontmatter.category).toBeTruthy();
        expect(frontmatter.version).toMatch(/^\d+\.\d+\.\d+$/);
      });

      it('has a valid category', () => {
        const { frontmatter } = loadTemplate(name);
        expect(VALID_CATEGORIES).toContain(frontmatter.category);
      });

      it('has non-empty body', () => {
        const { body } = loadTemplate(name);
        expect(body.length).toBeGreaterThan(100);
      });

      it('contains at least 3 sections', () => {
        const { body } = loadTemplate(name);
        const sections = body.match(/^## /gm);
        expect(sections?.length).toBeGreaterThanOrEqual(3);
      });

      it('contains {{variable}} placeholders', () => {
        const { body } = loadTemplate(name);
        const variables = body.match(/\{\{(\w+)\}\}/g);
        expect(variables?.length).toBeGreaterThanOrEqual(1);
      });

      it('has author set to xiaobai', () => {
        const { frontmatter } = loadTemplate(name);
        expect(frontmatter.author).toBe('xiaobai');
      });
    });
  }

  it('all 7 templates exist', () => {
    expect(BUILTIN_NAMES).toHaveLength(7);
    for (const name of BUILTIN_NAMES) {
      expect(existsSync(join(templatesDir, name, 'SKILL.md'))).toBe(true);
    }
  });
});
