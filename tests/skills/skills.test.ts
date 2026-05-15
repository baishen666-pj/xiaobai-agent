import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillSystem } from '../../src/skills/system.js';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `xiaobai-skills-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('SkillSystem CRUD', () => {
  it('starts with no skills', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    expect(skills.listSkills()).toHaveLength(0);
  });

  it('creates a skill from template', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    const skill = await skills.create('test-skill', 'A test skill', 'coding');
    expect(skill.name).toBe('test-skill');
    expect(skill.description).toBe('A test skill');
    expect(skill.category).toBe('coding');
  });

  it('loads skills from disk on startup', async () => {
    const dir = join(testDir, 'skills', 'my-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---
name: my-skill
description: Loaded from disk
category: analysis
version: 2.0.0
---

# My Skill
Content here`);

    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    const list = skills.listSkills();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('my-skill');
    expect(list[0].version).toBe('2.0.0');
  });

  it('deletes a skill', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    await skills.create('to-delete', 'Will be deleted');
    expect(skills.getSkill('to-delete')).toBeDefined();

    const result = await skills.delete('to-delete');
    expect(result).toBe(true);
    expect(skills.getSkill('to-delete')).toBeUndefined();
  });

  it('returns false when deleting non-existent skill', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    expect(await skills.delete('nope')).toBe(false);
  });
});

describe('SkillSystem Search & Filter', () => {
  beforeEach(async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    await skills.create('code-gen', 'Code generation', 'coding');
    await skills.create('code-review', 'Code review', 'review');
    await skills.create('doc-writer', 'Documentation writer', 'writing');
  });

  it('lists by category', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    const coding = skills.listByCategory('coding');
    expect(coding).toHaveLength(1);
    expect(coding[0].name).toBe('code-gen');
  });

  it('searches by name', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    const results = skills.search('code');
    expect(results.length).toBe(2);
  });

  it('searches by description', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    const results = skills.search('documentation');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('doc-writer');
  });
});

describe('SkillSystem Prompt Rendering', () => {
  it('renders skill prompt with variables', async () => {
    const dir = join(testDir, 'skills', 'render-test');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---
name: render-test
description: Test rendering
category: general
---

Fix the bug in {{file}} at line {{line}}.`);

    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    const prompt = skills.renderPrompt('render-test', {
      variables: { file: 'src/app.ts', line: '42' },
    });
    expect(prompt).not.toBeNull();
    expect(prompt!).toContain('src/app.ts');
    expect(prompt!).toContain('42');
    expect(prompt!).not.toContain('{{');
  });

  it('replaces unresolved variables with placeholders', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    await skills.create('unresolved', 'Test', 'general', '---\nname: unresolved\ndescription: Test\ncategory: general\n---\n\n{{missing}} variable');
    const prompt = skills.renderPrompt('unresolved');
    expect(prompt).toContain('[missing]');
  });

  it('returns null for non-existent skill', () => {
    const skills = new SkillSystem(testDir);
    expect(skills.renderPrompt('nope')).toBeNull();
  });
});

describe('SkillSystem System Prompt', () => {
  it('builds system prompt from all skills', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    await skills.create('skill-a', 'First skill');
    await skills.create('skill-b', 'Second skill');

    const prompt = skills.buildSystemPrompt();
    expect(prompt).toContain('skill-a');
    expect(prompt).toContain('skill-b');
    expect(prompt).toContain('Available Skills');
  });

  it('builds system prompt for selected skills', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    await skills.create('included', 'Include this');
    await skills.create('excluded', 'Do not include');

    const prompt = skills.buildSystemPrompt(['included']);
    expect(prompt).toContain('included');
    expect(prompt).not.toContain('excluded');
  });

  it('returns empty string when no skills', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    expect(skills.buildSystemPrompt()).toBe('');
  });
});

describe('SkillSystem Requirements', () => {
  it('checks env requirements', async () => {
    const dir = join(testDir, 'skills', 'req-test');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---
name: req-test
description: Requires env
category: general
---

Content`);

    const skills = new SkillSystem(testDir);
    await skills.loadAll();

    // Manually set requires since YAML frontmatter parsing is limited
    const skill = skills.getSkill('req-test');
    if (skill) {
      (skill as any).requires = { env: ['REQUIRED_VAR'] };
    }

    const result = skills.checkRequirements('req-test');
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain('env: REQUIRED_VAR');
  });

  it('returns satisfied when no requirements', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    await skills.create('no-req', 'No requirements');
    const result = skills.checkRequirements('no-req');
    expect(result.satisfied).toBe(true);
  });
});

describe('SkillSystem Stats', () => {
  it('returns correct stats', async () => {
    const skills = new SkillSystem(testDir);
    await skills.loadAll();
    await skills.create('a', 'Skill A', 'coding');
    await skills.create('b', 'Skill B', 'coding');
    await skills.create('c', 'Skill C', 'writing');

    const stats = skills.getStats();
    expect(stats.total).toBe(3);
    expect(stats.categories.coding).toBe(2);
    expect(stats.categories.writing).toBe(1);
  });
});
