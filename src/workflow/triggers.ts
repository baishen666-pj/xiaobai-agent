import { watch, type FSWatcher } from 'node:fs';
import type { WorkflowEngine } from './engine.js';
import type { WorkflowRegistry } from './registry.js';
import type { WorkflowTrigger } from './types.js';

interface TriggerHandle {
  type: string;
  stop(): void;
}

export class WorkflowTriggerManager {
  private engine: WorkflowEngine;
  private activeTriggers = new Map<string, TriggerHandle>();
  private webhookPaths = new Map<string, string>();

  constructor(engine: WorkflowEngine) {
    this.engine = engine;
  }

  startAll(registry: WorkflowRegistry): void {
    for (const workflow of registry.list()) {
      for (const trigger of workflow.triggers) {
        this.start(workflow.name, trigger);
      }
    }
  }

  start(workflowName: string, trigger: WorkflowTrigger): TriggerHandle {
    switch (trigger.type) {
      case 'file_change':
        return this.startFileWatch(workflowName, trigger.pattern);
      case 'cron':
        return this.startCron(workflowName, trigger.schedule);
      case 'webhook':
        return this.startWebhook(workflowName, trigger.path);
      default:
        return { type: 'manual', stop() {} };
    }
  }

  stop(workflowName: string): void {
    const handle = this.activeTriggers.get(workflowName);
    if (handle) {
      handle.stop();
      this.activeTriggers.delete(workflowName);
    }
  }

  stopAll(): void {
    for (const [name, handle] of this.activeTriggers) {
      handle.stop();
      this.activeTriggers.delete(name);
    }
  }

  getWebhookPaths(): Map<string, string> {
    return new Map(this.webhookPaths);
  }

  private startFileWatch(workflowName: string, pattern: string): TriggerHandle {
    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(pattern, { recursive: true }, (eventType) => {
        if (eventType === 'change') {
          void this.engine.run(workflowName);
        }
      });
    } catch {
      // Pattern may not exist yet
    }

    const handle: TriggerHandle = {
      type: 'file_change',
      stop: () => { watcher?.close(); },
    };
    this.activeTriggers.set(workflowName, handle);
    return handle;
  }

  private startCron(workflowName: string, schedule: string): TriggerHandle {
    const intervalMs = this.parseInterval(schedule);
    const timer = setInterval(() => {
      void this.engine.run(workflowName);
    }, intervalMs);

    const handle: TriggerHandle = {
      type: 'cron',
      stop: () => { clearInterval(timer); },
    };
    this.activeTriggers.set(workflowName, handle);
    return handle;
  }

  private startWebhook(workflowName: string, path: string): TriggerHandle {
    this.webhookPaths.set(path, workflowName);

    const handle: TriggerHandle = {
      type: 'webhook',
      stop: () => { this.webhookPaths.delete(path); },
    };
    this.activeTriggers.set(workflowName, handle);
    return handle;
  }

  private parseInterval(schedule: string): number {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length === 5) {
      // Basic cron: every N minutes pattern
      const minutePart = parts[0];
      if (minutePart.startsWith('*/')) {
        const mins = parseInt(minutePart.slice(2), 10);
        if (!isNaN(mins) && mins > 0) return mins * 60 * 1000;
      }
    }
    // Default: every 5 minutes
    return 5 * 60 * 1000;
  }
}
