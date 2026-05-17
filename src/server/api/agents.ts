import type { Router } from '../router.js';
import { sendJson } from '../validation.js';
import type { RemoteAgentBridge } from '../../protocols/orchestrator-bridge.js';
import type { AgentMarketplace } from '../../protocols/agent-marketplace.js';

export function registerAgentRoutes(
  router: Router,
  bridge: RemoteAgentBridge,
  marketplace: AgentMarketplace,
): void {
  router.get('/api/agents', async (ctx) => {
    const agents = bridge.listAgents();
    sendJson(ctx, 200, { agents });
  }, { summary: 'List registered remote agents', tags: ['agents'] });

  router.post('/api/agents/register', async (ctx) => {
    const body = ctx.body as Record<string, unknown> ?? {};
    const { name, url, protocol, role } = body;

    if (!name || !url || !protocol) {
      sendJson(ctx, 400, { error: 'name, url, and protocol are required' });
      return;
    }

    if (protocol !== 'a2a' && protocol !== 'acp') {
      sendJson(ctx, 400, { error: 'protocol must be "a2a" or "acp"' });
      return;
    }

    await bridge.registerAgent({
      name: name as string,
      url: url as string,
      protocol: protocol as 'a2a' | 'acp',
      role: role as string | undefined,
    });

    sendJson(ctx, 201, { success: true, name });
  }, { summary: 'Register a remote agent', tags: ['agents'] });

  router.delete('/api/agents/:name', async (ctx) => {
    const { name } = ctx.params;
    const agent = bridge.getAgent(name);
    if (!agent) {
      sendJson(ctx, 404, { error: `Agent "${name}" not found` });
      return;
    }

    bridge.unregisterAgent(name);
    sendJson(ctx, 200, { success: true });
  }, { summary: 'Unregister a remote agent', tags: ['agents'] });

  router.post('/api/agents/:name/execute', async (ctx) => {
    const { name } = ctx.params;
    const body = ctx.body as Record<string, unknown> ?? {};
    const prompt = body.prompt as string | undefined;

    if (!prompt) {
      sendJson(ctx, 400, { error: 'prompt is required' });
      return;
    }

    const agent = bridge.getAgent(name);
    if (!agent) {
      sendJson(ctx, 404, { error: `Agent "${name}" not found` });
      return;
    }

    const result = await bridge.executeRemoteTask(name, prompt);
    sendJson(ctx, 200, result);
  }, { summary: 'Execute a task on a remote agent', tags: ['agents'] });

  router.get('/api/agents/marketplace', async (ctx) => {
    const query = ctx.query?.q as string | undefined;
    const tag = ctx.query?.tag as string | undefined;
    const entries = query ? marketplace.search(query) : marketplace.browse(tag);
    sendJson(ctx, 200, { entries });
  }, { summary: 'Browse the agent marketplace', tags: ['agents'] });

  router.post('/api/agents/marketplace/:id/install', async (ctx) => {
    const { id } = ctx.params;
    const result = await marketplace.install(id);
    if (result.success) {
      sendJson(ctx, 200, { success: true });
    } else {
      sendJson(ctx, 400, { error: result.error });
    }
  }, { summary: 'Install an agent from the marketplace', tags: ['agents'] });
}
