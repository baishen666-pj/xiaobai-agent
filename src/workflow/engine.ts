import { randomUUID } from 'node:crypto';
import type { AgentDeps } from '../core/agent.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { createTask } from '../core/task.js';
import { getRole } from '../core/roles.js';
import { renderTemplate, evaluateCondition } from './template.js';
import type { WorkflowDefinition, WorkflowRun, StepResult, WorkflowRunStatus } from './types.js';
import type { WorkflowRegistry } from './registry.js';

export type WorkflowEngineEvent =
  | { type: 'run_started'; runId: string; workflowName: string }
  | { type: 'step_started'; runId: string; stepId: string }
  | { type: 'step_completed'; runId: string; stepId: string; result: StepResult }
  | { type: 'step_failed'; runId: string; stepId: string; error: string }
  | { type: 'step_skipped'; runId: string; stepId: string; reason: string }
  | { type: 'run_completed'; runId: string }
  | { type: 'run_failed'; runId: string; error: string };

export interface WorkflowEngineOptions {
  maxConcurrency?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: WorkflowEngineEvent) => void;
}

export class WorkflowEngine {
  private registry: WorkflowRegistry;
  private deps: AgentDeps;
  private activeRuns = new Map<string, WorkflowRun>();
  private abortControllers = new Map<string, AbortController>();

  constructor(deps: AgentDeps, registry: WorkflowRegistry) {
    this.deps = deps;
    this.registry = registry;
  }

  async run(
    workflowName: string,
    variables?: Record<string, string>,
    options?: WorkflowEngineOptions,
  ): Promise<WorkflowRun> {
    const definition = this.registry.get(workflowName);
    if (!definition) throw new Error(`Workflow "${workflowName}" not found`);

    const mergedVars = { ...definition.variables, ...variables };
    const runId = `run_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const abortController = new AbortController();

    if (options?.abortSignal) {
      options.abortSignal.addEventListener('abort', () => abortController.abort());
    }

    this.abortControllers.set(runId, abortController);

    const run: WorkflowRun = {
      id: runId,
      workflowName,
      status: 'running',
      variables: mergedVars,
      stepResults: new Map(),
      startedAt: Date.now(),
    };

    this.activeRuns.set(runId, run);

    const emit = (event: WorkflowEngineEvent) => options?.onEvent?.(event);

    try {
      emit({ type: 'run_started', runId, workflowName });

      const sortedSteps = this.topologicalSort(definition.steps);
      const completedStepIds = new Set<string>();
      const enqueued = new Set<string>();
      const pending = new Set(sortedSteps.map((s) => s.id));
      const maxConcurrency = options?.maxConcurrency ?? 4;

      const stepPromises: Promise<void>[] = [];

      while (pending.size > 0) {
        if (abortController.signal.aborted) break;

        let launched = 0;
        for (const step of sortedSteps) {
          if (enqueued.has(step.id) || completedStepIds.has(step.id)) continue;

          const depsReady = step.dependsOn.every((depId) => completedStepIds.has(depId));
          if (!depsReady) continue;

          // Check condition
          if (step.condition) {
            const context = this.buildContext(run, mergedVars);
            if (!evaluateCondition(step.condition, context)) {
              run.stepResults.set(step.id, {
                stepId: step.id, status: 'skipped', output: '', tokensUsed: 0, durationMs: 0,
              });
              completedStepIds.add(step.id);
              pending.delete(step.id);
              emit({ type: 'step_skipped', runId, stepId: step.id, reason: 'Condition false' });
              continue;
            }
          }

          enqueued.add(step.id);
          launched++;

          const stepPromise = this.executeStep(run, step, mergedVars, emit, abortController.signal)
            .then((result) => {
              run.stepResults.set(step.id, result);
              completedStepIds.add(step.id);
              pending.delete(step.id);
            })
            .catch((err) => {
              run.stepResults.set(step.id, {
                stepId: step.id, status: 'failed', output: '', tokensUsed: 0,
                durationMs: 0, error: String(err),
              });
              completedStepIds.add(step.id);
              pending.delete(step.id);
            });

          stepPromises.push(stepPromise);

          if (stepPromises.filter((p) => {
            // count unsettled
            let settled = false;
            p.then(() => { settled = true; }).catch(() => { settled = true; });
            return !settled;
          }).length >= maxConcurrency) break;
        }

        if (launched === 0 && pending.size > 0) {
          // Wait for any running step to complete
          await Promise.race(stepPromises);
        } else if (launched > 0) {
          // Wait at least one step to settle before next iteration
          await Promise.race([...stepPromises, new Promise<void>((r) => setTimeout(r, 0))]);
        }
      }

      await Promise.allSettled(stepPromises);

      const hasFailure = [...run.stepResults.values()].some((r) => r.status === 'failed');
      run.status = hasFailure ? 'failed' : 'completed';
      run.completedAt = Date.now();

      if (hasFailure) {
        emit({ type: 'run_failed', runId, error: 'One or more steps failed' });
      } else {
        emit({ type: 'run_completed', runId });
      }
    } catch (err) {
      run.status = 'failed';
      run.error = String(err);
      run.completedAt = Date.now();
      emit({ type: 'run_failed', runId, error: String(err) });
    } finally {
      this.abortControllers.delete(runId);
    }

    return run;
  }

  getRun(runId: string): WorkflowRun | undefined {
    return this.activeRuns.get(runId);
  }

  cancel(runId: string): boolean {
    const controller = this.abortControllers.get(runId);
    if (!controller) return false;
    controller.abort();
    const run = this.activeRuns.get(runId);
    if (run) {
      run.status = 'cancelled';
      run.completedAt = Date.now();
    }
    return true;
  }

  private async executeStep(
    run: WorkflowRun,
    step: import('./types.js').WorkflowStep,
    variables: Record<string, string>,
    emit: (event: WorkflowEngineEvent) => void,
    signal: AbortSignal,
  ): Promise<StepResult> {
    emit({ type: 'step_started', runId: run.id, stepId: step.id });

    const context = this.buildContext(run, variables);
    const prompt = renderTemplate(step.prompt, context);

    let attempts = 0;
    const maxAttempts = step.onError === 'retry' ? step.maxRetries + 1 : 1;

    while (attempts < maxAttempts) {
      if (signal.aborted) {
        return { stepId: step.id, status: 'skipped', output: '', tokensUsed: 0, durationMs: 0 };
      }

      const start = Date.now();
      try {
        const output = await this.runAgent(step, prompt, signal);
        const result: StepResult = {
          stepId: step.id,
          status: 'completed',
          output,
          tokensUsed: 0,
          durationMs: Date.now() - start,
        };
        emit({ type: 'step_completed', runId: run.id, stepId: step.id, result });
        return result;
      } catch (err) {
        attempts++;
        if (attempts >= maxAttempts) {
          if (step.onError === 'fallback' && step.fallbackPrompt) {
            const fallbackPrompt = renderTemplate(step.fallbackPrompt, context);
            try {
              const output = await this.runAgent(step, fallbackPrompt, signal);
              const result: StepResult = {
                stepId: step.id,
                status: 'completed',
                output,
                tokensUsed: 0,
                durationMs: Date.now() - start,
              };
              emit({ type: 'step_completed', runId: run.id, stepId: step.id, result });
              return result;
            } catch {
              // Fall through to failure
            }
          }

          if (step.onError === 'skip') {
            emit({ type: 'step_skipped', runId: run.id, stepId: step.id, reason: String(err) });
            return { stepId: step.id, status: 'skipped', output: '', tokensUsed: 0, durationMs: Date.now() - start };
          }

          emit({ type: 'step_failed', runId: run.id, stepId: step.id, error: String(err) });
          throw err;
        }
      }
    }

    return { stepId: step.id, status: 'failed', output: '', tokensUsed: 0, durationMs: 0 };
  }

  private async runAgent(
    step: import('./types.js').WorkflowStep,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (!this.deps.provider) throw new Error('No provider configured');

    const role = step.role ? getRole(step.role) : undefined;
    const systemPrompt = role?.systemPrompt ?? 'You are a helpful assistant.';

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: prompt },
    ];

    const timeout = step.timeout ?? 300000;
    const result = await Promise.race([
      this.deps.provider.chat(messages),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Step timeout')), timeout),
      ),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('Cancelled'));
        signal.addEventListener('abort', () => reject(new Error('Cancelled')));
      }),
    ]);

    return typeof result === 'string' ? result : (result as any)?.content ?? String(result);
  }

  private buildContext(run: WorkflowRun, variables: Record<string, string>): Record<string, unknown> {
    const stepOutputs: Record<string, unknown> = {};
    for (const [id, result] of run.stepResults) {
      stepOutputs[id] = { output: result.output, status: result.status };
    }
    return { variables, steps: stepOutputs, workflowName: run.workflowName, runId: run.id };
  }

  private topologicalSort(steps: import('./types.js').WorkflowStep[]): import('./types.js').WorkflowStep[] {
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const sorted: import('./types.js').WorkflowStep[] = [];

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const step = stepMap.get(id);
      if (step) {
        for (const dep of step.dependsOn) visit(dep);
        sorted.push(step);
      }
    };

    for (const step of steps) visit(step.id);
    return sorted;
  }
}
