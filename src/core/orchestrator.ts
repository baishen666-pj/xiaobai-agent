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
import { generateTaskPlan, type TaskPlan } from './planner.js';
import { analyzeFailure, type ReflectionOutcome } from './reflection.js';
import type { RemoteAgentBridge } from '../protocols/orchestrator-bridge.js';
import type { Message } from '../session/manager.js';
import type { ChatOptions } from '../provider/types.js';
import { join } from 'node:path';

export type OrchestratorEvent =
  | { type: 'plan'; tasks: Task[] }
  | { type: 'plan_generated'; plan: TaskPlan }
  | { type: 'task_reflecting'; task: Task; error: string }
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
  taskTimeoutMs?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: OrchestratorEvent) => void;
  source?: SessionSource;
}

const DEFAULT_MAX_DEPTH = 1;
const MAX_DEPTH_CAP = 3;
const DEFAULT_TASK_TIMEOUT = 300_000; // 5 minutes

interface AgentHandle {
  id: string;
  role: RoleDefinition;
  loop: AgentLoop;
  busy: boolean;
  currentTask?: Task;
  depth: number;
  cost: number;
}

interface RemoteAgentHandle {
  id: string;
  name: string;
  role: string;
  isRemote: true;
}

export class Orchestrator {
  private deps: AgentDeps;
  private workspace: Workspace;
  private tasks: Task[] = [];
  private taskIndex = new Map<string, Task>();
  private agents = new Map<string, AgentHandle>();
  private bridge?: RemoteAgentBridge;
  private completedIds = new Set<string>();
  private results: TaskResult[] = [];
  private listeners: Array<(event: OrchestratorEvent) => void> = [];
  private maxDepth: number;
  private taskTimeoutMs: number;
  private source: SessionSource;
  private agentCounter = 0;
  private taskSettledResolvers: Array<() => void> = [];

  constructor(deps: AgentDeps, workspaceDir?: string) {
    this.deps = deps;
    this.maxDepth = DEFAULT_MAX_DEPTH;
    this.taskTimeoutMs = DEFAULT_TASK_TIMEOUT;
    this.source = 'orchestrator';
    this.workspace = new Workspace(
      workspaceDir ?? join(process.cwd(), '.xiaobai', 'workspace'),
    );
  }

  setBridge(bridge: RemoteAgentBridge): void {
    this.bridge = bridge;
  }

  onEvent(listener: (event: OrchestratorEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: OrchestratorEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
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
    this.taskIndex.set(task.id, task);
    return task;
  }

  getTasks(): Task[] {
    return [...this.tasks];
  }

  getTask(id: string): Task | undefined {
    return this.taskIndex.get(id);
  }

  getResults(): TaskResult[] {
    return [...this.results];
  }

  async planAndExecute(goal: string, options: OrchestratorOptions = {}): Promise<TaskResult[]> {
    this.tasks = [];
    this.taskIndex.clear();
    this.results = [];
    this.completedIds.clear();

    const chatFn = (messages: Message[], opts: ChatOptions) =>
      this.deps.provider.chat(messages, opts);

    const plan = await generateTaskPlan(chatFn, goal);
    this.emit({ type: 'plan_generated', plan });

    const idMapping = new Map<string, string>();
    for (const planned of plan.tasks) {
      const task = this.addTask({
        description: planned.description,
        role: planned.role,
        input: planned.input,
        priority: planned.priority,
        dependencies: planned.dependencies
          .map((depId) => idMapping.get(depId))
          .filter((d): d is string => d !== undefined),
      });
      idMapping.set(planned.id, task.id);
    }

    return this.execute(options);
  }

  async execute(options: OrchestratorOptions = {}): Promise<TaskResult[]> {
    const { maxConcurrency = 3, abortSignal } = options;
    this.maxDepth = Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_DEPTH_CAP);
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT;
    this.source = options.source ?? 'orchestrator';

    if (options.onEvent) this.onEvent(options.onEvent);
    await this.workspace.init();

    this.results = [];
    this.completedIds.clear();

    const isPending = (t: Task) => t.status === 'pending';
    const isRunning = (t: Task) => t.status === 'running';

    this.emit({ type: 'plan', tasks: [...this.tasks] });

    const inflight: Promise<void>[] = [];

    const waitForTask = (): Promise<void> => {
      return new Promise<void>((resolve) => {
        this.taskSettledResolvers.push(resolve);
      });
    };

    while (true) {
      if (abortSignal?.aborted) {
        for (const task of this.tasks) {
          if (isPending(task) || isRunning(task)) task.status = 'cancelled';
        }
        break;
      }

      const pendingTasks: Task[] = [];
      let runningCount = 0;
      for (const t of this.tasks) {
        if (isPending(t)) pendingTasks.push(t);
        else if (isRunning(t)) runningCount++;
      }

      if (pendingTasks.length === 0 && runningCount === 0) break;

      const readyTasks = sortTasksByPriority(
        pendingTasks.filter((t) => isTaskReady(t, this.completedIds)),
      );

      let launched = 0;
      while (runningCount + launched < maxConcurrency && readyTasks.length > 0) {
        const task = readyTasks.shift()!;

        // Check for remote agent matching the task role
        const remoteHandle = this.tryCreateRemoteHandle(task.role);
        if (remoteHandle) {
          task.status = 'assigned';
          task.assignedAgentId = remoteHandle.id;
          task.startedAt = Date.now();

          const p = this.runRemoteTask(remoteHandle, task).catch((err) => {
            console.error(`[orchestrator] Remote task ${task.id} failed:`, err);
          }).finally(() => {
            const resolve = this.taskSettledResolvers.shift();
            if (resolve) resolve();
          });
          inflight.push(p);
          launched++;
          continue;
        }

        const handle = this.createAgentHandle(task.role, 0);
        if (!handle) continue;

        task.status = 'assigned';
        task.assignedAgentId = handle.id;
        task.startedAt = Date.now();

        const p = this.runTask(handle, task, options).catch((err) => {
          console.error(`[orchestrator] Task ${task.id} failed:`, err);
        }).finally(() => {
          const resolve = this.taskSettledResolvers.shift();
          if (resolve) resolve();
        });
        inflight.push(p);
        launched++;
      }

      if (launched === 0 && this.tasks.some(isRunning)) {
        await waitForTask();
      }
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

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Task timed out after ${this.taskTimeoutMs}ms`)), this.taskTimeoutMs);
      });

      const runPromise = (async () => {
        for await (const event of handle.loop.run(
          `${task.description}\n\nContext:\n${inputContext}`,
          sessionId,
          {
            maxTurns: handle.role.maxTurns,
            abortSignal: options.abortSignal,
            systemPromptOverride: handle.role.systemPrompt,
            onEvent: (loopEvent) => {
              this.emit({ type: 'task_progress', task, event: loopEvent });
            },
          },
        )) {
          if (event.type === 'text') output += event.content;
          if (event.type === 'stream') output += event.content;
          if (event.tokens) tokensUsed += event.tokens;
        }
      })();

      await Promise.race([runPromise, timeoutPromise]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);

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
        this.applyReflection(task, errorMsg, output).catch((err) => { console.error('[orchestrator] Reflection failed:', err); });
      }
    } finally {
      handle.busy = false;
      handle.currentTask = undefined;
    }
  }

  private async applyReflection(task: Task, errorMsg: string, output: string): Promise<void> {
    this.emit({ type: 'task_reflecting', task, error: errorMsg });

    try {
      const chatFn = (messages: Message[], opts: ChatOptions) => this.deps.provider.chat(messages, opts);
      const reflection = await analyzeFailure(chatFn, task.description, errorMsg, output);

      if (reflection.strategy === 'give_up') {
        task.maxRetries = task.retries;
        return;
      }

      if (reflection.strategy === 'retry_different_role' && reflection.suggestedRole) {
        task.role = reflection.suggestedRole;
      }

      if (reflection.strategy === 'retry_simplified' && reflection.revisedDescription) {
        task.description = reflection.revisedDescription;
      }
    } catch {
      // Reflection failed — keep original task config, just retry
    }
  }

  private createAgentHandle(roleId: string, depth: number): AgentHandle | null {
    if (depth > this.maxDepth) return null;

    const role = getRole(roleId);
    const id = `agent_${++this.agentCounter}_${roleId}_d${depth}`;

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

  private tryCreateRemoteHandle(role: string): RemoteAgentHandle | null {
    if (!this.bridge) return null;
    const agents = this.bridge.listAgents();
    const match = agents.find((a) => a.role === role);
    if (!match) return null;

    return {
      id: `remote_${match.name}_${++this.agentCounter}`,
      name: match.name,
      role,
      isRemote: true,
    };
  }

  private async runRemoteTask(handle: RemoteAgentHandle, task: Task): Promise<void> {
    task.status = 'running';
    this.emit({ type: 'task_started', task, agentId: handle.id });

    const startTime = Date.now();
    const result = await this.bridge!.executeRemoteTask(handle.name, task.description);

    const taskResult: TaskResult = {
      taskId: task.id,
      success: result.success,
      output: result.output,
      artifacts: [],
      tokensUsed: result.tokensUsed ?? 0,
      durationMs: Date.now() - startTime,
      error: result.error,
    };

    task.status = result.success ? 'completed' : 'failed';
    task.completedAt = Date.now();
    task.result = taskResult;
    this.results.push(taskResult);
    this.completedIds.add(task.id);

    if (result.success) {
      this.workspace.set(`result:${task.id}`, taskResult, handle.id);
      this.emit({ type: 'task_completed', task, result: taskResult });
    } else {
      this.emit({ type: 'task_failed', task, error: result.error ?? 'Remote task failed' });
    }
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
