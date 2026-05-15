import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, watchFile, unwatchFile } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
type SkillCategory = (typeof SKILL_CATEGORIES)[number];

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

    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const skill = this.loadSkillFromDir(join(this.skillsDir, entry.name));
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
      try { unwatchFile(join(this.skillsDir, name)); } catch {}
    }
    this.watchers.clear();
  }

  private loadSkillFromDir(dir: string): Skill | null {
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(skillPath)) return null;

    const content = readFileSync(skillPath, 'utf-8');
    const skill = this.parseSkillMd(content, dir);
    if (skill.name !== 'unnamed' && this.isBuiltin(skill.name)) {
      skill.source = 'builtin';
    }
    return skill;
  }

  private parseSkillMd(content: string, _dir?: string): Skill {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const defaultSkill: Skill = {
      name: 'unnamed',
      description: '',
      category: 'general',
      content: content,
      version: '1.0.0',
    };

    if (!frontmatterMatch) return defaultSkill;

    const fm = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    const getFmValue = (key: string): string | undefined => {
      const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
      return match?.[1]?.trim();
    };

    const getFmArray = (key: string): string[] | undefined => {
      const section = fm.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)*)`, 'm'));
      if (!section) return undefined;
      return section[1]
        .split('\n')
        .map((l) => l.replace(/^\s+-\s+/, '').trim())
        .filter(Boolean);
    };

    return {
      ...defaultSkill,
      name: getFmValue('name') ?? 'unnamed',
      description: getFmValue('description') ?? '',
      category: getFmValue('category') ?? 'general',
      version: getFmValue('version') ?? '1.0.0',
      author: getFmValue('author'),
      requires: getFmArray('requires') ? { env: getFmArray('requires') } : undefined,
      content: body.trim(),
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

    const parts: string[] = ['## Available Skills\n'];
    for (const skill of skills) {
      parts.push(`### ${skill.name}`);
      parts.push(skill.description);
      parts.push('');
    }

    return parts.join('\n');
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
}
