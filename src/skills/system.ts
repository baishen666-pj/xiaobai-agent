import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, watchFile, unwatchFile } from 'node:fs';
import { readFile as readFileAsync, readdir as readdirAsync } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../utils/frontmatter.js';

export interface Skill {
  name: string;
  description: string;
  category: string;
  content: string;
  version: string;
  author?: string;
  platforms?: string[];
  requires?: {
    bins?: string[];
    env?: string[];
    config?: Record<string, string>;
  };
  metadata?: Record<string, unknown>;
  source?: 'builtin' | 'user' | 'installed';
}

export interface SkillExecutionContext {
  variables: Record<string, string>;
  tools: string[];
  memory: string[];
  userMessage: string;
}

const SKILL_CATEGORIES = ['coding', 'analysis', 'writing', 'planning', 'review', 'devops', 'general'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

const BUILTIN_SKILLS = [
  'code-review', 'test-gen', 'refactor', 'doc-writer',
  'security-audit', 'debug', 'explain',
  'perf-audit', 'api-design', 'git-ops', 'migrate', 'architect', 'i18n',
] as const;

export class SkillSystem {
  private skillsDir: string;
  private skills = new Map<string, Skill>();
  private loaded = false;
  private watchers = new Map<string, string>();

  constructor(configDir: string) {
    this.skillsDir = join(configDir, 'skills');
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  async loadAll(): Promise<void> {
    if (this.loaded) return;
    this.skills.clear();

    if (!existsSync(this.skillsDir)) return;

    const entries = await readdirAsync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const skill = await this.loadSkillFromDir(join(this.skillsDir, entry.name));
      if (skill) this.skills.set(skill.name, skill);
    }

    this.loaded = true;
  }

  async reload(): Promise<void> {
    this.loaded = false;
    await this.loadAll();
  }

  watchForChanges(callback?: () => void): void {
    if (!existsSync(this.skillsDir)) return;

    try {
      import('node:fs').then(({ watch }) => {
        watch(this.skillsDir, { recursive: true }, async (eventType, filename) => {
          if (filename && (filename.endsWith('SKILL.md') || filename.endsWith('.md'))) {
            await this.reload();
            callback?.();
          }
        });
        this.watchers.set('main', 'watching');
      });
    } catch {
      // Watch not supported
    }
  }

  stopWatching(): void {
    for (const [name] of this.watchers) {
      try { unwatchFile(join(this.skillsDir, name)); } catch { /* file may not exist */ }
    }
    this.watchers.clear();
  }

  private async loadSkillFromDir(dir: string): Promise<Skill | null> {
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(skillPath)) return null;

    try {
      const content = await readFileAsync(skillPath, 'utf-8');
      const skill = this.parseSkillMd(content, dir);
      if (skill.name !== 'unnamed' && this.isBuiltin(skill.name)) {
        skill.source = 'builtin';
      }
      return skill;
    } catch {
      return null;
    }
  }

  private parseSkillMd(content: string, _dir?: string): Skill {
    const defaultSkill: Skill = {
      name: 'unnamed',
      description: '',
      category: 'general',
      content: content,
      version: '1.0.0',
    };

    const parsed = parseFrontmatter(content);
    if (!parsed) return defaultSkill;

    const { meta, body } = parsed;

    const getFmValue = (key: string): string | undefined => meta[key];

    const getFmArray = (key: string): string[] | undefined => {
      const val = meta[key];
      if (!val) return undefined;
      return val.split(',').map((s) => s.trim()).filter(Boolean);
    };

    return {
      ...defaultSkill,
      name: getFmValue('name') ?? 'unnamed',
      description: getFmValue('description') ?? '',
      category: getFmValue('category') ?? 'general',
      version: getFmValue('version') ?? '1.0.0',
      author: getFmValue('author'),
      requires: getFmArray('requires') ? { env: getFmArray('requires') } : undefined,
      content: body,
    };
  }

  getSummary(): string {
    const entries = Array.from(this.skills.values());
    if (entries.length === 0) return '';
    return entries.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  listSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  listByCategory(category: string): Skill[] {
    return Array.from(this.skills.values()).filter((s) => s.category === category);
  }

  search(query: string): Skill[] {
    const lower = query.toLowerCase();
    return Array.from(this.skills.values()).filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.content.toLowerCase().includes(lower),
    );
  }

  async create(name: string, description: string, category: SkillCategory = 'general', content?: string): Promise<Skill> {
    const dir = join(this.skillsDir, name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const skillContent = content ?? this.generateTemplate(name, description, category);
    writeFileSync(join(dir, 'SKILL.md'), skillContent, 'utf-8');
    const skill = this.parseSkillMd(skillContent, dir);
    this.skills.set(skill.name, skill);
    return skill;
  }

  async delete(name: string): Promise<boolean> {
    if (!this.skills.has(name)) return false;
    this.skills.delete(name);
    return true;
  }

  async installFromUrl(url: string, name?: string): Promise<Skill | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const content = await response.text();
      const parsed = this.parseSkillMd(content);
      const skillName = name ?? parsed.name;
      const skill = await this.create(skillName, parsed.description, (parsed.category as SkillCategory) ?? 'general', content);
      skill.source = 'installed';
      return skill;
    } catch {
      return null;
    }
  }

  renderPrompt(name: string, context?: Partial<SkillExecutionContext>): string | null {
    const skill = this.skills.get(name);
    if (!skill) return null;

    let rendered = skill.content;

    if (context?.variables) {
      for (const [key, value] of Object.entries(context.variables)) {
        rendered = rendered.replaceAll(`{{${key}}}`, value);
      }
    }

    // Replace remaining unresolved variables with placeholders
    rendered = rendered.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => `[${key}]`);

    return rendered;
  }

  buildSystemPrompt(selectedSkills?: string[]): string {
    const skills = selectedSkills
      ? selectedSkills.map((n) => this.skills.get(n)).filter(Boolean) as Skill[]
      : Array.from(this.skills.values());

    if (skills.length === 0) return '';

    // Progressive disclosure Level 0: names + descriptions only (~3K tokens)
    const parts: string[] = ['## Available Skills\n'];
    for (const skill of skills) {
      const src = skill.source ? ` [${skill.source}]` : '';
      parts.push(`- **${skill.name}**${src}: ${skill.description}`);
    }
    parts.push('');
    parts.push('Use skills by name when relevant. Full content loaded on demand.');

    return parts.join('\n');
  }

  // Progressive disclosure Level 1: full content of a specific skill
  getFullSkillPrompt(name: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) return null;
    return `## Skill: ${skill.name}\n\n${skill.content}`;
  }

  // Progressive disclosure Level 2: skill content with a file reference
  getSkillWithFile(name: string, filePath: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) return null;
    return `## Skill: ${skill.name}\n\nTarget: ${filePath}\n\n${skill.content}`;
  }

  checkRequirements(name: string): { satisfied: boolean; missing: string[] } {
    const skill = this.skills.get(name);
    if (!skill?.requires) return { satisfied: true, missing: [] };

    const missing: string[] = [];

    if (skill.requires.env) {
      for (const envVar of skill.requires.env) {
        if (!process.env[envVar]) missing.push(`env: ${envVar}`);
      }
    }

    return { satisfied: missing.length === 0, missing };
  }

  getStats(): { total: number; categories: Record<string, number> } {
    const categories: Record<string, number> = {};
    for (const skill of this.skills.values()) {
      categories[skill.category] = (categories[skill.category] ?? 0) + 1;
    }
    return { total: this.skills.size, categories };
  }

  static listBuiltinNames(): string[] {
    return [...BUILTIN_SKILLS];
  }

  isBuiltin(name: string): boolean {
    return (BUILTIN_SKILLS as readonly string[]).includes(name);
  }

  async installBuiltin(name?: string): Promise<string[]> {
    const templatesDir = join(dirname(fileURLToPath(import.meta.url)), 'templates');
    const toInstall = name ? [name] : [...BUILTIN_SKILLS];
    const installed: string[] = [];

    for (const skillName of toInstall) {
      const srcDir = join(templatesDir, skillName);
      if (!existsSync(srcDir)) continue;
      const destDir = join(this.skillsDir, skillName);
      if (existsSync(join(destDir, 'SKILL.md'))) continue;
      mkdirSync(destDir, { recursive: true });
      copyFileSync(join(srcDir, 'SKILL.md'), join(destDir, 'SKILL.md'));
      installed.push(skillName);
    }

    if (installed.length > 0) await this.reload();
    return installed;
  }

  private generateTemplate(name: string, description: string, category: string): string {
    return `---
name: ${name}
description: ${description}
category: ${category}
version: 1.0.0
---

# ${name}

${description}

## Instructions

1. Analyze the request
2. Apply the skill logic
3. Return the result

## Examples

\`\`\`
Input: {{input}}
Output: [result]
\`\`\`

## Notes

- Adapt to the specific context
- Follow the user's preferences
`;
  }

  // ── Self-learning (from Hermes pattern) ──

  async learnFromExperience(
    task: string,
    approach: string,
    outcome: 'success' | 'partial' | 'failed',
    category: SkillCategory = 'general',
  ): Promise<Skill | null> {
    if (outcome === 'failed') return null;

    const name = this.deriveSkillName(task);
    const existing = this.skills.get(name);
    if (existing) {
      return this.improveSkill(existing, task, approach);
    }

    const description = this.deriveDescription(task);
    const content = this.buildLearnedContent(task, approach);

    const skill = await this.create(name, description, category, content);
    skill.source = 'user';
    return skill;
  }

  private async improveSkill(skill: Skill, task: string, approach: string): Promise<Skill> {
    const existingContent = skill.content;
    const addition = `\n\n## Learned Pattern (${new Date().toISOString().slice(0, 10)})\n\nTask: ${task}\nApproach: ${approach}`;

    const newContent = existingContent + addition;
    const dir = join(this.skillsDir, skill.name);
    writeFileSync(join(dir, 'SKILL.md'), `---
name: ${skill.name}
description: ${skill.description}
category: ${skill.category}
version: ${skill.version}
---

${newContent}`, 'utf-8');

    await this.reload();
    return this.skills.get(skill.name) ?? skill;
  }

  private deriveSkillName(task: string): string {
    const words = task.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'from', 'that', 'this'].includes(w))
      .slice(0, 3);
    return words.join('-') || 'learned-skill';
  }

  private deriveDescription(task: string): string {
    const cleaned = task.replace(/\n/g, ' ').trim();
    return cleaned.length > 100 ? cleaned.slice(0, 97) + '...' : cleaned;
  }

  private buildLearnedContent(task: string, approach: string): string {
    return `---
name: ${this.deriveSkillName(task)}
description: ${this.deriveDescription(task)}
category: general
version: 1.0.0
---

# ${this.deriveSkillName(task)}

${this.deriveDescription(task)}

## Learned Approach

Task: ${task}

Approach that worked:
${approach}

## Variables

- \`{{target}}\` — The target to apply this pattern to
- \`{{context}}\` — Additional context`;
  }
}
