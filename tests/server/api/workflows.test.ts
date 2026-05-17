import { describe, it, expect, vi } from 'vitest';
import { registerWorkflowRoutes } from '../../../src/server/api/workflows.js';
import { Router } from '../../../src/server/router.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorkflowDefinition } from '../../../src/workflow/types.js';

function createMockReq(method: string, url: string, body?: unknown): IncomingMessage {
  return {
    method,
    url,
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
    on: (event: string, handler: any) => {
      if (event === 'data' && body) handler(Buffer.from(JSON.stringify(body)));
      if (event === 'end') handler();
    },
    destroy: () => {},
  } as any;
}

function createMockRes() {
  let body = '';
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    headersSent: false,
    writeHead(status: number, hdrs?: Record<string, string>) {
      (this as any).statusCode = status;
      if (hdrs) Object.assign((this as any).headers, hdrs);
    },
    end(data?: string) {
      (this as any).body = typeof data === 'string' ? data : '';
    },
    setHeader() {},
    write() {},
  } as any as ServerResponse;
}

const sampleWorkflow: WorkflowDefinition = {
  name: 'code-review',
  version: '1.0.0',
  description: 'Automated code review',
  tags: ['review', 'automation'],
  steps: [
    { id: 'step1', prompt: 'Review the code', dependsOn: [], onError: 'abort', maxRetries: 1, timeout: 300000, parallel: false },
    { id: 'step2', prompt: 'Summarize findings', dependsOn: ['step1'], onError: 'abort', maxRetries: 1, timeout: 300000, parallel: false },
  ],
  triggers: [{ type: 'manual' }],
};

function createMockRegistry(workflows: WorkflowDefinition[] = [sampleWorkflow]) {
  const map = new Map(workflows.map((w) => [w.name, w]));
  return {
    list: vi.fn(() => workflows),
    get: vi.fn((name: string) => map.get(name)),
  };
}

function createMockEngine() {
  return {
    run: vi.fn(async (name: string, variables?: Record<string, string>) => ({
      id: 'run_test_123',
      workflowName: name,
      status: 'completed' as const,
      variables: variables ?? {},
      stepResults: new Map([
        ['step1', { stepId: 'step1', status: 'completed' as const, output: 'OK', tokensUsed: 50, durationMs: 100 }],
        ['step2', { stepId: 'step2', status: 'completed' as const, output: 'Summary done', tokensUsed: 30, durationMs: 50 }],
      ]),
      startedAt: Date.now() - 150,
      completedAt: Date.now(),
    })),
  };
}

describe('Workflow API', () => {
  it('GET /api/workflows lists workflows with step count', async () => {
    const router = new Router();
    const registry = createMockRegistry();
    const engine = createMockEngine();
    registerWorkflowRoutes(router, registry as any, engine as any);

    const req = createMockReq('GET', '/api/workflows');
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse((res as any).body);
    expect(parsed.workflows).toHaveLength(1);
    expect(parsed.workflows[0].name).toBe('code-review');
    expect(parsed.workflows[0].stepCount).toBe(2);
    expect(parsed.workflows[0].tags).toEqual(['review', 'automation']);
  });

  it('GET /api/workflows returns empty array when none exist', async () => {
    const router = new Router();
    const registry = createMockRegistry([]);
    const engine = createMockEngine();
    registerWorkflowRoutes(router, registry as any, engine as any);

    const req = createMockReq('GET', '/api/workflows');
    const res = createMockRes();
    await router.handle(req, res);

    const parsed = JSON.parse((res as any).body);
    expect(parsed.workflows).toHaveLength(0);
  });

  it('POST /api/workflows/:name/run executes workflow', async () => {
    const router = new Router();
    const registry = createMockRegistry();
    const engine = createMockEngine();
    registerWorkflowRoutes(router, registry as any, engine as any);

    const req = createMockReq('POST', '/api/workflows/code-review/run', { variables: { lang: 'ts' } });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse((res as any).body);
    expect(parsed.runId).toBe('run_test_123');
    expect(parsed.status).toBe('completed');
    expect(parsed.stepResults).toBeDefined();
    expect(engine.run).toHaveBeenCalledWith('code-review', { lang: 'ts' });
  });

  it('POST /api/workflows/:name/run returns 404 for unknown workflow', async () => {
    const router = new Router();
    const registry = createMockRegistry();
    const engine = createMockEngine();
    registerWorkflowRoutes(router, registry as any, engine as any);

    const req = createMockReq('POST', '/api/workflows/nonexistent/run', {});
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(404);
    const parsed = JSON.parse((res as any).body);
    expect(parsed.error).toContain('not found');
  });

  it('POST /api/workflows/:name/run works without variables', async () => {
    const router = new Router();
    const registry = createMockRegistry();
    const engine = createMockEngine();
    registerWorkflowRoutes(router, registry as any, engine as any);

    const req = createMockReq('POST', '/api/workflows/code-review/run', {});
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    expect(engine.run).toHaveBeenCalledWith('code-review', {});
  });

  it('POST /api/workflows/:name/run treats body keys as variables when no variables key', async () => {
    const router = new Router();
    const registry = createMockRegistry();
    const engine = createMockEngine();
    registerWorkflowRoutes(router, registry as any, engine as any);

    const req = createMockReq('POST', '/api/workflows/code-review/run', { lang: 'go', env: 'prod' });
    const res = createMockRes();
    await router.handle(req, res);

    expect(res.statusCode).toBe(200);
    expect(engine.run).toHaveBeenCalledWith('code-review', { lang: 'go', env: 'prod' });
  });
});
