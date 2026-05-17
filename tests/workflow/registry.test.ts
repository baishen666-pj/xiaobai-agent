import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkflowRegistry } from '../../src/workflow/registry.js';
import type { WorkflowDefinition } from '../../src/workflow/types.js';

describe('WorkflowRegistry', () => {
  let tempDir: string;
  let registry: WorkflowRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wf-test-'));
    registry = new WorkflowRegistry(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const sampleWorkflow: WorkflowDefinition = {
    name: 'test-workflow',
    version: '1.0.0',
    description: 'A test workflow',
    tags: ['test'],
    steps: [
      { id: 's1', prompt: 'Step 1' },
      { id: 's2', prompt: 'Step 2', dependsOn: ['s1'] },
    ],
    triggers: [{ type: 'manual' }],
  };

  it('should create and retrieve a workflow', async () => {
    await registry.create(sampleWorkflow);
    const found = registry.get('test-workflow');
    expect(found).toBeDefined();
    expect(found!.name).toBe('test-workflow');
    expect(found!.steps).toHaveLength(2);
  });

  it('should reject duplicate workflow names', async () => {
    await registry.create(sampleWorkflow);
    await expect(registry.create(sampleWorkflow)).rejects.toThrow('already exists');
  });

  it('should list workflows', async () => {
    await registry.create(sampleWorkflow);
    await registry.create({ ...sampleWorkflow, name: 'second-workflow' });
    const list = registry.list();
    expect(list).toHaveLength(2);
  });

  it('should update a workflow', async () => {
    await registry.create(sampleWorkflow);
    const updated = await registry.update('test-workflow', { description: 'Updated' });
    expect(updated.description).toBe('Updated');
    expect(registry.get('test-workflow')!.description).toBe('Updated');
  });

  it('should throw on update of non-existent workflow', async () => {
    await expect(registry.update('nope', { description: 'x' })).rejects.toThrow('not found');
  });

  it('should delete a workflow', async () => {
    await registry.create(sampleWorkflow);
    const result = await registry.delete('test-workflow');
    expect(result).toBe(true);
    expect(registry.get('test-workflow')).toBeUndefined();
  });

  it('should return false on delete of non-existent', async () => {
    expect(await registry.delete('nope')).toBe(false);
  });

  it('should search workflows by name', async () => {
    await registry.create(sampleWorkflow);
    await registry.create({ ...sampleWorkflow, name: 'deploy-workflow', description: 'Deploy things', tags: ['deploy'] });
    const results = registry.search('test');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('test-workflow');
  });

  it('should search workflows by tag', async () => {
    await registry.create(sampleWorkflow);
    await registry.create({ ...sampleWorkflow, name: 'other', tags: ['other'] });
    const results = registry.listByTag('test');
    expect(results).toHaveLength(1);
  });

  it('should persist and reload workflows', async () => {
    await registry.create(sampleWorkflow);
    const registry2 = new WorkflowRegistry(tempDir);
    await registry2.loadAll();
    expect(registry2.get('test-workflow')).toBeDefined();
  });
});
