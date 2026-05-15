import type { AgentDeps } from './agent.js';
import { getRole, getRoleToolFilter, type RoleDefinition } from './roles.js';
import {
  createTask,
  isTaskReady,
  sortTasksByPriority,
  type Task,
  type TaskResult,
  type TaskArtifact,
} from './task.js';
import { Workspace } from './workspace.js';
import { AgentLoop, type LoopEvent } from './loop.js';
import { ToolRegistry } from '../tools/registry.js';
import type { AgentEvent, SessionSource } from './submissions.js';
import { join } from 'node:path';

export type OrchestratorEvent =
  | { type: 'plan'; tasks: Task[] }
  | { type: 'task_started'; task: Task; agentId: string }
  | { type: 'task_progress'; task: Task; event: LoopEvent }
  | { type: 'task_completed'; task: Task; result: TaskResult }
  | { type: 'task_failed'; task: Task; error: string }
  | { type: 'all_completed'; results: TaskResult[] }
  | { type: 'error'; error: string };

export interface OrchestratorOptions {
  maxConcurrency?: number;
  maxRetries?: number;
  maxDepth?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: OrchestratorEvent) => void;
  source?: SessionSource;
}

const DEFAULT_MAX_DEPTH = 1;
const MAX_DEPTH_CAP = 3;

interface AgentHandle {
  id: string;
  role: RoleDefinition;
  loop: AgentLoop;
  busy: boolean;
  currentTask?: Task;
  depth: number;
  cost: number;
}

let agentCounter = 0;

export class Orchestrator {
  private deps: AgentDeps;
  private workspace: Workspace;
  private tasks: Task[] = [];
  private agents = new Map<string, AgentHandle>();
  private completedIds = new Set<string>();
  private results: TaskResult[] = [];
  private listeners: ((event: OrchestratorEvent) => void) = () => {};
  private maxDepth: number;
  private source: SessionSource;

  constructor(deps: AgentDeps, workspaceDir?: string) {
    this.deps = deps;
    this.maxDepth = DEFAULT_MAX_DEPTH;
    this.source = 'orchestrator';
    this.workspace = new Workspace(
      workspaceDir ?? join(process.cwd(), '.xiaobai', 'workspace'),
    );
  }

  onEvent(listener: (event: OrchestratorEvent) => void): () => void {
    const prev = this.listeners;
    this.listeners = (event) => { prev(event); listener(event); };
    return () => { this.listeners = prev; };
  }

  private emit(event: OrchestratorEvent): void {
    this.listeners(event);
  }

  addTask(params: {
    description: string;
    role: string;
    input?: Record<string, unknown>;
    priority?: Task['priority'];
    dependencies?: string[];
    parentTaskId?: string;
  }): Task {
    const task = createTask({
      description: params.description,
      role: params.role,
      input: params.input,
      priority: params.priority,
      dependencies: params.dependencies,
      parentTaskId: params.parentTaskId,
    });
    this.tasks.push(task);
    return task;
  }

  getTasks(): Task[] {
    return [...this.tasks];
  }

  getTask(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  getResults(): TaskResult[] {
    return [...this.results];
  }

  async execute(options: OrchestratorOptions = {}): Promise<TaskResult[]> {
    const { maxConcurrency = 3, abortSignal } = options;
    this.maxDepth = Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_DEPTH_CAP);
    this.source = options.source ?? 'orchestrator';

    if (options.onEvent) this.onEvent(options.onEvent);
    await this.workspace.init();

    this.results = [];
    this.completedIds.clear();

    const isPending = (t: Task) => t.status === 'pending';
    const isRunning = (t: Task) => t.status === 'running';

    this.emit({ type: 'plan', tasks: [...this.tasks] });

    const inflight: Promise<void>[] = [];

    while (true) {
      if (abortSignal?.aborted) {
        for (const task of this.tasks) {
          if (isPending(task) || isRunning(task)) task.status = 'cancelled';
        }
        break;
      }

      const pendingCount = this.tasks.filter(isPending).length;
      const runningCount = this.tasks.filter(isRunning).length;

      if (pendingCount === 0 && runningCount === 0) break;

      const readyTasks = sortTasksByPriority(
        this.tasks.filter((t) => isPending(t) && isTaskReady(t, this.completedIds)),
      );

      let launched = 0;
      while (runningCount + launched < maxConcurrency && readyTasks.length > 0) {
        const task = readyTasks.shift()!;
        const handle = this.createAgentHandle(task.role, 0);
        if (!handle) continue;

        task.status = 'assigned';
        task.assignedAgentId = handle.id;
        task.startedAt = Date.now();

        const p = this.runTask(handle, task, options).catch(() => {});
        inflight.push(p);
        launched++;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await Promise.all(inflight);

    this.emit({ type: 'all_completed', results: this.results });
    return this.results;
  }

  private async runTask(
    handle: AgentHandle,
    task: Task,
    options: OrchestratorOptions,
  ): Promise<void> {
    task.status = 'running';
    handle.busy = true;
    handle.currentTask = task;

    this.emit({ type: 'task_started', task, agentId: handle.id });

    const startTime = Date.now();
    let output = '';
    let tokensUsed = 0;
    const artifacts: TaskArtifact[] = [];

    try {
      const sessionId = `orch_${this.source}_${task.id}`;
      const inputContext = this.buildTaskContext(task);

      for await (const event of handle.loop.run(
        `${task.description}\n\nContext:\n${inputContext}`,
        sessionId,
        {
          maxTurns: handle.role.maxTurns,
          abortSignal: options.abortSignal,
          onEvent: (loopEvent) => {
            this.emit({ type: 'task_progress', task, event: loopEvent });
          },
        },
      )) {
        if (event.type === 'text') output += event.content;
        if (event.type === 'stream') output += event.content;
        if (event.tokens) tokensUsed += event.tokens;
      }

      task.status = 'completed';
      task.completedAt = Date.now();

      handle.cost += tokensUsed;

      const result: TaskResult = {
        taskId: task.id,
        success: true,
        output,
        artifacts,
        tokensUsed,
        durationMs: Date.now() - startTime,
      };

      task.result = result;
      this.results.push(result);
      this.completedIds.add(task.id);
      this.workspace.set(`result:${task.id}`, result, handle.id);
      this.emit({ type: 'task_completed', task, result });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      task.retries++;

      if (task.retries >= task.maxRetries) {
        task.status = 'failed';
        task.completedAt = Date.now();
        const result: TaskResult = {
          taskId: task.id,
          success: false,
          output,
          artifacts,
          tokensUsed,
          durationMs: Date.now() - startTime,
          error: errorMsg,
        };
        task.result = result;
        this.results.push(result);
        this.completedIds.add(task.id);
        this.emit({ type: 'task_failed', task, error: errorMsg });
      } else {
        task.status = 'pending';
      }
    } finally {
      handle.busy = false;
      handle.currentTask = undefined;
    }
  }

  private createAgentHandle(roleId: string, depth: number): AgentHandle | null {
    if (depth > this.maxDepth) return null;

    const role = getRole(roleId);
    const id = `agent_${++agentCounter}_${roleId}_d${depth}`;

    const loop = new AgentLoop({
      provider: this.deps.provider,
      tools: this.deps.tools,
      sessions: this.deps.sessions,
      hooks: this.deps.hooks,
      config: this.deps.config,
      memory: this.deps.memory,
      security: this.deps.security,
      skills: this.deps.skills,
    });

    const handle: AgentHandle = { id, role, loop, busy: false, depth, cost: 0 };
    this.agents.set(id, handle);
    return handle;
  }

  private buildTaskContext(task: Task): string {
    const parts: string[] = [];
    parts.push(`## Task: ${task.description}`);
    parts.push(`Role: ${task.role}`);

    if (task.parentTaskId) {
      const parent = this.getTask(task.parentTaskId);
      if (parent?.result) {
        parts.push(`\n## Parent Task Result:\n${parent.result.output}`);
      }
    }

    for (const depId of task.dependencies) {
      const dep = this.getTask(depId);
      if (dep?.result?.success) {
        parts.push(`\n## Dependency (${depId}) Result:\n${dep.result.output}`);
      }
    }

    if (Object.keys(task.input).length > 0) {
      parts.push(`\n## Input:\n${JSON.stringify(task.input, null, 2)}`);
    }

    const wsSnapshot = this.workspace.snapshot();
    if (Object.keys(wsSnapshot).length > 0) {
      parts.push(`\n## Workspace State:\n${JSON.stringify(wsSnapshot, null, 2)}`);
    }

    return parts.join('\n');
  }

  getWorkspace(): Workspace {
    return this.workspace;
  }

  getAgentStatus(): Array<{ id: string; role: string; busy: boolean; currentTask?: string; cost: number }> {
    return Array.from(this.agents.values()).map((a) => ({
      id: a.id,
      role: a.role.id,
      busy: a.busy,
      currentTask: a.currentTask?.id,
      cost: a.cost,
    }));
  }

  getTotalCost(): number {
    return Array.from(this.agents.values()).reduce((sum, a) => sum + a.cost, 0);
  }
}
