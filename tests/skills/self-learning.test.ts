import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillSystem } from '../../src/skills/system.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Skill Progressive Disclosure', () => {
  let skillsDir: string;
  let skills: SkillSystem;

  beforeEach(async () => {
    skillsDir = mkdtempSync(join(tmpdir(), 'xiaobai-skills-'));
    skills = new SkillSystem(skillsDir);
    await skills.loadAll();
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  it('buildSystemPrompt shows names only (Level 0)', async () => {
    await skills.create('my-skill', 'Does cool stuff', 'coding');
    const prompt = skills.buildSystemPrompt();

    expect(prompt).toContain('my-skill');
    expect(prompt).toContain('Does cool stuff');
    expect(prompt).toContain('Full content loaded on demand');
  });

  it('getFullSkillPrompt returns full content (Level 1)', async () => {
    await skills.create('full-skill', 'A skill with details', 'coding');
    const prompt = skills.getFullSkillPrompt('full-skill');

    expect(prompt).toContain('Skill: full-skill');
    expect(prompt).toContain('Instructions');
  });

  it('getSkillWithFile adds file reference (Level 2)', async () => {
    await skills.create('file-skill', 'Works on files', 'coding');
    const prompt = skills.getSkillWithFile('file-skill', '/src/main.ts');

    expect(prompt).toContain('Target: /src/main.ts');
    expect(prompt).toContain('Skill: file-skill');
  });

  it('returns null for unknown skill in Level 1/2', () => {
    expect(skills.getFullSkillPrompt('nonexistent')).toBeNull();
    expect(skills.getSkillWithFile('nonexistent', '/path')).toBeNull();
  });
});

describe('Self-Learning Skills', () => {
  let skillsDir: string;
  let skills: SkillSystem;

  beforeEach(async () => {
    skillsDir = mkdtempSync(join(tmpdir(), 'xiaobai-learn-'));
    skills = new SkillSystem(skillsDir);
    await skills.loadAll();
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  it('creates skill from successful experience', async () => {
    const skill = await skills.learnFromExperience(
      'optimize database queries for user search',
      'Added composite index on (name, email) columns',
      'success',
    );

    expect(skill).not.toBeNull();
    expect(skill!.name).toBeTruthy();
    expect(skill!.source).toBe('user');
  });

  it('does not create skill from failed experience', async () => {
    const skill = await skills.learnFromExperience(
      'fix login bug',
      'tried X but it failed',
      'failed',
    );

    expect(skill).toBeNull();
  });

  it('improves existing skill on repeated success', async () => {
    await skills.learnFromExperience(
      'optimize query performance',
      'First approach',
      'success',
    );

    const improved = await skills.learnFromExperience(
      'optimize query performance again',
      'Better approach with caching',
      'success',
    );

    expect(improved).not.toBeNull();
    const full = skills.getFullSkillPrompt(improved!.name);
    expect(full).toContain('Learned Pattern');
  });

  it('derives sensible skill names', () => {
    const name = (skills as any).deriveSkillName('Write unit tests for the auth module');
    expect(name).toBeTruthy();
    expect(name).not.toContain('the');
    expect(name.split('-').length).toBeLessThanOrEqual(3);
  });

  it('truncates long descriptions', () => {
    const desc = (skills as any).deriveDescription('x'.repeat(200));
    expect(desc.length).toBeLessThanOrEqual(100);
  });
});
