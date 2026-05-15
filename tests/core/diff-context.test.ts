import { describe, it, expect } from 'vitest';
import { DiffContextManager } from '../../src/core/diff-context.js';

describe('DiffContextManager', () => {
  it('returns full diff on first call', () => {
    const mgr = new DiffContextManager();
    const snap = mgr.buildSnapshot('sys prompt', 'tools json', 'mem block', 'skill block');
    const diff = mgr.computeDiff(snap);

    expect(diff.systemPromptChanged).toBe(true);
    expect(diff.toolsChanged).toBe(true);
    expect(diff.memoryChanged).toBe(true);
    expect(diff.skillsChanged).toBe(true);
    expect(diff.fullSystemPrompt).toBe('sys prompt');
  });

  it('detects no change when snapshot is identical', () => {
    const mgr = new DiffContextManager();
    const snap1 = mgr.buildSnapshot('sys prompt', 'tools json', 'mem block', 'skill block');
    mgr.computeDiff(snap1);

    const snap2 = mgr.buildSnapshot('sys prompt', 'tools json', 'mem block', 'skill block');
    const diff = mgr.computeDiff(snap2);

    expect(diff.systemPromptChanged).toBe(false);
    expect(diff.toolsChanged).toBe(false);
    expect(diff.memoryChanged).toBe(false);
    expect(diff.skillsChanged).toBe(false);
  });

  it('detects system prompt change', () => {
    const mgr = new DiffContextManager();
    const snap1 = mgr.buildSnapshot('old prompt', 'tools', 'mem', 'skill');
    mgr.computeDiff(snap1);

    const snap2 = mgr.buildSnapshot('new prompt', 'tools', 'mem', 'skill');
    const diff = mgr.computeDiff(snap2);

    expect(diff.systemPromptChanged).toBe(true);
    expect(diff.fullSystemPrompt).toBe('new prompt');
  });

  it('detects tool definition change', () => {
    const mgr = new DiffContextManager();
    const snap1 = mgr.buildSnapshot('prompt', 'old tools', 'mem', 'skill');
    mgr.computeDiff(snap1);

    const snap2 = mgr.buildSnapshot('prompt', 'new tools', 'mem', 'skill');
    const diff = mgr.computeDiff(snap2);

    expect(diff.toolsChanged).toBe(true);
    expect(diff.systemPromptChanged).toBe(false);
  });

  it('resets reference snapshot', () => {
    const mgr = new DiffContextManager();
    const snap = mgr.buildSnapshot('prompt', 'tools', 'mem', 'skill');
    mgr.computeDiff(snap);

    expect(mgr.hasReference()).toBe(true);
    mgr.reset();
    expect(mgr.hasReference()).toBe(false);
  });
});
