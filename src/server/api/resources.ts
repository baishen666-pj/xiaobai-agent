import type { Router } from '../router.js';
import { sendJson } from '../validation.js';
import type { AgentDeps } from '../../core/agent.js';
import { ProviderRouter } from '../../provider/router.js';

export function registerResourceRoutes(router: Router, deps: AgentDeps): void {
  router.get('/api/models', async (ctx) => {
    const providers = ProviderRouter.getAvailableProviders();
    sendJson(ctx, 200, { providers });
  }, { summary: 'List available providers/models', tags: ['resources'] });

  router.get('/api/tools', async (ctx) => {
    const tools = deps.tools?.getToolDefinitions?.() ?? [];
    sendJson(ctx, 200, { tools });
  }, { summary: 'List available tools', tags: ['resources'] });

  router.get('/api/plugins', async (ctx) => {
    const plugins = deps.plugins?.list?.() ?? [];
    sendJson(ctx, 200, { plugins });
  }, { summary: 'List installed plugins', tags: ['resources'] });
}
