import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SkillSystem } from '../../src/skills/system.js';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('SkillSystem - extended coverage', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'xiaobai-skills-ext-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('loadAll edge cases', () => {
    it('skips directories starting with dot', async () => {
      const dotDir = join(testDir, 'skills', '.hidden-skill');
      mkdirSync(dotDir, { recursive: true });
      writeFileSync(join(dotDir, 'SKILL.md'), '---\nname: hidden\n---\nContent');

      const validDir = join(testDir, 'skills', 'visible-skill');
      mkdirSync(validDir, { recursive: true });
      writeFileSync(join(validDir, 'SKILL.md'), '---\nname: visible\ndescription: Visible\n---\nContent');

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      expect(skills.listSkills()).toHaveLength(1);
      expect(skills.getSkill('visible')).toBeDefined();
    });

    it('skips directories starting with underscore', async () => {
      const uDir = join(testDir, 'skills', '_internal');
      mkdirSync(uDir, { recursive: true });
      writeFileSync(join(uDir, 'SKILL.md'), '---\nname: internal\n---\nContent');

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      expect(skills.listSkills()).toHaveLength(0);
    });

    it('skips files (non-directories) in skills dir', async () => {
      mkdirSync(join(testDir, 'skills'), { recursive: true });
      writeFileSync(join(testDir, 'skills', 'readme.txt'), 'not a skill');

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      expect(skills.listSkills()).toHaveLength(0);
    });

    it('skips directory without SKILL.md', async () => {
      const noSkillDir = join(testDir, 'skills', 'no-skill-file');
      mkdirSync(noSkillDir, { recursive: true });
      writeFileSync(join(noSkillDir, 'other.md'), 'Content');

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      expect(skills.listSkills()).toHaveLength(0);
    });

    it('returns early on second loadAll call', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('test', 'A test', 'coding');

      // Second call should skip since loaded=true
      await skills.loadAll();
      // The skill should still be there because clear only happens if loaded is false
      expect(skills.listSkills()).toHaveLength(1);
    });

    it('handles skills dir being deleted after construction', async () => {
      // Construct with a valid dir, then delete skills subfolder
      const skills = new SkillSystem(testDir);
      rmSync(join(testDir, 'skills'), { recursive: true, force: true });

      // Should not throw, just return with no skills
      skills['loaded'] = false;
      await skills.loadAll();
      expect(skills.listSkills()).toHaveLength(0);
    });
  });

  describe('reload', () => {
    it('reloads skills from disk', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('first', 'First', 'coding');
      expect(skills.listSkills()).toHaveLength(1);

      // Add a new skill directly on disk
      const newDir = join(testDir, 'skills', 'second');
      mkdirSync(newDir, { recursive: true });
      writeFileSync(join(newDir, 'SKILL.md'), '---\nname: second\ndescription: Second\n---\nContent');

      await skills.reload();
      expect(skills.listSkills()).toHaveLength(2);
    });
  });

  describe('parseSkillMd', () => {
    it('parses skill with author field', async () => {
      const dir = join(testDir, 'skills', 'authored');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---
name: authored
description: Has author
category: coding
version: 1.0.0
author: test-author
---

Authored content`);

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      const skill = skills.getSkill('authored');
      expect(skill).toBeDefined();
      expect(skill!.author).toBe('test-author');
    });

    it('parses skill with requires as array', async () => {
      const dir = join(testDir, 'skills', 'req-skill');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---
name: req-skill
description: Requires stuff
requires:
  - ENV_VAR_1
  - ENV_VAR_2
---

Content`);

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      const skill = skills.getSkill('req-skill');
      expect(skill).toBeDefined();
      expect(skill!.requires).toBeDefined();
      expect(skill!.requires!.env).toEqual(['ENV_VAR_1', 'ENV_VAR_2']);
    });

    it('handles content without frontmatter', async () => {
      const dir = join(testDir, 'skills', 'no-fm');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'Just plain content without frontmatter');

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      const skill = skills.getSkill('unnamed');
      expect(skill).toBeDefined();
      expect(skill!.content).toContain('Just plain content');
    });

    it('marks builtin skills with source=builtin', async () => {
      const dir = join(testDir, 'skills', 'code-review');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---
name: code-review
description: Review code
category: review
---

Review content`);

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      const skill = skills.getSkill('code-review');
      expect(skill).toBeDefined();
      expect(skill!.source).toBe('builtin');
    });

    it('does not mark non-builtin skills as builtin', async () => {
      const dir = join(testDir, 'skills', 'custom-skill');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---
name: custom-skill
description: Custom
category: general
---

Custom content`);

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      const skill = skills.getSkill('custom-skill');
      expect(skill).toBeDefined();
      expect(skill!.source).toBeUndefined();
    });
  });

  describe('getSummary', () => {
    it('returns empty string when no skills loaded', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      expect(skills.getSummary()).toBe('');
    });

    it('returns formatted summary of loaded skills', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('alpha', 'Alpha description');
      await skills.create('beta', 'Beta description');

      const summary = skills.getSummary();
      expect(summary).toContain('alpha: Alpha description');
      expect(summary).toContain('beta: Beta description');
    });
  });

  describe('search', () => {
    it('searches by skill content', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('deep-search', 'A skill', 'general', '---\nname: deep-search\ndescription: A skill\ncategory: general\n---\n\nContains special_keyword_xyz content');

      const results = skills.search('special_keyword_xyz');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('deep-search');
    });
  });

  describe('checkRequirements', () => {
    it('returns satisfied when skill does not exist', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      const result = skills.checkRequirements('nonexistent');
      expect(result.satisfied).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('returns satisfied when skill has no requires field', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('no-reqs', 'No requirements');
      const result = skills.checkRequirements('no-reqs');
      expect(result.satisfied).toBe(true);
    });

    it('checks env requirements against process.env', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('env-skill', 'Needs env');
      const skill = skills.getSkill('env-skill')!;
      skill.requires = { env: ['MY_REQUIRED_VAR'] };

      delete process.env.MY_REQUIRED_VAR;
      const result = skills.checkRequirements('env-skill');
      expect(result.satisfied).toBe(false);
      expect(result.missing).toContain('env: MY_REQUIRED_VAR');
    });

    it('returns satisfied when env vars are set', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('env-ok', 'Has env');
      const skill = skills.getSkill('env-ok')!;
      skill.requires = { env: ['PATH'] }; // PATH always exists

      const result = skills.checkRequirements('env-ok');
      expect(result.satisfied).toBe(true);
      expect(result.missing).toHaveLength(0);
    });
  });

  describe('isBuiltin and listBuiltinNames', () => {
    it('identifies builtin skill names', () => {
      const skills = new SkillSystem(testDir);
      expect(skills.isBuiltin('code-review')).toBe(true);
      expect(skills.isBuiltin('test-gen')).toBe(true);
      expect(skills.isBuiltin('refactor')).toBe(true);
      expect(skills.isBuiltin('nonexistent')).toBe(false);
    });

    it('lists all builtin names', () => {
      const names = SkillSystem.listBuiltinNames();
      expect(names).toContain('code-review');
      expect(names).toContain('test-gen');
      expect(names).toContain('security-audit');
      expect(names).toContain('debug');
      expect(names).toContain('architect');
      expect(names).toContain('i18n');
      expect(names.length).toBeGreaterThan(10);
    });
  });

  describe('buildSystemPrompt with source', () => {
    it('includes source tag in system prompt', async () => {
      const dir = join(testDir, 'skills', 'code-review');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---
name: code-review
description: Review code
category: review
---

Review`);

      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      const prompt = skills.buildSystemPrompt();
      expect(prompt).toContain('[builtin]');
    });
  });

  describe('installFromUrl', () => {
    it('returns null on fetch failure', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      const result = await skills.installFromUrl('http://localhost:1/nonexistent-url');
      expect(result).toBeNull();
    });

    it('installs a skill from a URL with custom name', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `---
name: url-skill
description: From URL
category: general
---

URL content`,
      }) as any;

      const result = await skills.installFromUrl('http://example.com/skill.md', 'custom-name');
      expect(result).not.toBeNull();
      // The name comes from parsed frontmatter content, not the argument
      expect(result!.name).toBe('url-skill');
      expect(result!.source).toBe('installed');

      globalThis.fetch = originalFetch;
    });

    it('uses parsed name when no name argument provided', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `---
name: auto-name
description: Auto named
category: coding
---

Content`,
      }) as any;

      const result = await skills.installFromUrl('http://example.com/skill.md');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('auto-name');

      globalThis.fetch = originalFetch;
    });

    it('returns null when fetch returns non-ok', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }) as any;

      const result = await skills.installFromUrl('http://example.com/missing');
      expect(result).toBeNull();

      globalThis.fetch = originalFetch;
    });
  });

  describe('watchForChanges and stopWatching', () => {
    it('stopWatching clears watchers without error', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      skills.stopWatching();
      expect(skills['watchers'].size).toBe(0);
    });

    it('watchForChanges returns early if skills dir does not exist', async () => {
      const noSkillsDir = join(testDir, 'no-skills-' + Date.now());
      const skills = new SkillSystem(noSkillsDir);
      // The constructor creates skillsDir, but let's explicitly remove it
      rmSync(join(noSkillsDir, 'skills'), { recursive: true, force: true });
      // Should not throw since existsSync returns false
      skills.watchForChanges();
      // Give the async import a moment to resolve
      await new Promise((r) => setTimeout(r, 100));
    });
  });

  describe('create skill with custom content', () => {
    it('creates skill using provided content', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();

      const customContent = `---
name: custom
description: Custom content
category: writing
---

Custom skill body`;
      const skill = await skills.create('custom', 'Custom content', 'writing', customContent);
      expect(skill.name).toBe('custom');
      expect(skill.description).toBe('Custom content');
      expect(skill.category).toBe('writing');
    });

    it('overwrites skill directory if it already exists', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('dup', 'First version');
      await skills.create('dup', 'Second version');
      const skill = skills.getSkill('dup');
      expect(skill).toBeDefined();
    });
  });

  describe('getSkill', () => {
    it('returns undefined for non-existent skill', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      expect(skills.getSkill('nope')).toBeUndefined();
    });
  });

  describe('getFullSkillPrompt', () => {
    it('returns formatted prompt for existing skill', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('prompt-test', 'Testing prompts');
      const prompt = skills.getFullSkillPrompt('prompt-test');
      expect(prompt).not.toBeNull();
      expect(prompt).toContain('Skill: prompt-test');
    });
  });

  describe('getSkillWithFile', () => {
    it('returns formatted prompt with file path', async () => {
      const skills = new SkillSystem(testDir);
      await skills.loadAll();
      await skills.create('file-test', 'File testing');
      const prompt = skills.getSkillWithFile('file-test', '/src/index.ts');
      expect(prompt).not.toBeNull();
      expect(prompt).toContain('Target: /src/index.ts');
      expect(prompt).toContain('Skill: file-test');
    });
  });
});
