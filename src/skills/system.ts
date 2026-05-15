import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
}

export class SkillSystem {
  private skillsDir: string;
  private skills = new Map<string, Skill>();
  private loaded = false;

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

  private loadSkillFromDir(dir: string): Skill | null {
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(skillPath)) return null;

    const content = readFileSync(skillPath, 'utf-8');
    return this.parseSkillMd(content);
  }

  private parseSkillMd(content: string): Skill {
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

    return {
      ...defaultSkill,
      name: getFmValue('name') ?? 'unnamed',
      description: getFmValue('description') ?? '',
      category: getFmValue('category') ?? 'general',
      version: getFmValue('version') ?? '1.0.0',
      author: getFmValue('author'),
      content: body.trim(),
    };
  }

  getSummary(): string {
    const entries = Array.from(this.skills.values());
    if (entries.length === 0) return '';
    return entries
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  listSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  async create(name: string, content: string): Promise<void> {
    const dir = join(this.skillsDir, name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');
    const skill = this.parseSkillMd(content);
    this.skills.set(skill.name, skill);
  }

  async delete(name: string): Promise<boolean> {
    if (!this.skills.has(name)) return false;
    this.skills.delete(name);
    return true;
  }
}
