import { describe, it, expect, vi } from 'vitest';
import { WorkflowTriggerManager } from '../../src/workflow/triggers.js';
import type { WorkflowEngine } from '../../src/workflow/engine.js';

describe('WorkflowTriggerManager', () => {
  it('should handle manual triggers (no-op)', () => {
    const mockEngine = { run: vi.fn() } as unknown as WorkflowEngine;
    const manager = new WorkflowTriggerManager(mockEngine);
    const handle = manager.start('test', { type: 'manual' });
    expect(handle.type).toBe('manual');
    handle.stop();
  });

  it('should start and stop cron triggers', () => {
    vi.useFakeTimers();
    const mockEngine = { run: vi.fn() } as unknown as WorkflowEngine;
    const manager = new WorkflowTriggerManager(mockEngine);

    manager.start('cron-wf', { type: 'cron', schedule: '*/1 * * * *' });

    vi.advanceTimersByTime(60 * 1000);
    expect(mockEngine.run).toHaveBeenCalledWith('cron-wf');

    manager.stopAll();
    vi.advanceTimersByTime(120 * 1000);
    expect(mockEngine.run).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('should register webhook paths', () => {
    const mockEngine = { run: vi.fn() } as unknown as WorkflowEngine;
    const manager = new WorkflowTriggerManager(mockEngine);

    manager.start('hook-wf', { type: 'webhook', path: '/hooks/test' });
    const paths = manager.getWebhookPaths();
    expect(paths.get('/hooks/test')).toBe('hook-wf');

    manager.stopAll();
    expect(manager.getWebhookPaths().size).toBe(0);
  });

  it('should stop individual triggers', () => {
    const mockEngine = { run: vi.fn() } as unknown as WorkflowEngine;
    const manager = new WorkflowTriggerManager(mockEngine);

    manager.start('cron-wf', { type: 'cron', schedule: '*/5 * * * *' });
    manager.stop('cron-wf');
    // No error thrown = success
  });
});
