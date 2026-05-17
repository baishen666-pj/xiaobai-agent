import type { Router } from '../router.js';
import { sendJson } from '../validation.js';
import type { WorkflowRegistry } from '../../workflow/registry.js';
import type { WorkflowEngine } from '../../workflow/engine.js';

export function registerWorkflowRoutes(
  router: Router,
  registry: WorkflowRegistry,
  engine: WorkflowEngine,
): void {
  router.get('/api/workflows', async (ctx) => {
    const workflows = registry.list();
    sendJson(ctx, 200, {
      workflows: workflows.map((w) => ({
        name: w.name,
        version: w.version,
        description: w.description,
        tags: w.tags,
        stepCount: w.steps.length,
      })),
    });
  }, { summary: 'List workflows', tags: ['workflows'] });

  router.post('/api/workflows/:name/run', async (ctx) => {
    const { name } = ctx.params;
    const workflow = registry.get(name);
    if (!workflow) {
      sendJson(ctx, 404, { error: `Workflow "${name}" not found` });
      return;
    }

    const body = ctx.body as Record<string, unknown> ?? {};
    const variables = (body.variables as Record<string, string>) ?? (body as Record<string, string>);

    const run = await engine.run(name, variables);
    sendJson(ctx, 200, {
      runId: run.id,
      status: run.status,
      stepResults: Object.fromEntries(run.stepResults),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    });
  }, { summary: 'Run a workflow', tags: ['workflows'] });
}
