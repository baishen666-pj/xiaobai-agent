import type { Router } from '../router.js';
import { sendJson } from '../validation.js';
import type { AgentDeps } from '../../core/agent.js';

export function registerSessionRoutes(router: Router, deps: AgentDeps): void {
  router.get('/api/sessions', async (ctx) => {
    if (!deps.sessions) {
      sendJson(ctx, 503, { error: 'Session manager not configured' });
      return;
    }
    const sessions = await deps.sessions.listSessions();
    sendJson(ctx, 200, { sessions });
  }, { summary: 'List sessions', tags: ['sessions'] });

  router.get('/api/sessions/:id', async (ctx) => {
    if (!deps.sessions) {
      sendJson(ctx, 503, { error: 'Session manager not configured' });
      return;
    }
    try {
      const session = await deps.sessions.loadSessionState(ctx.params.id);
      if (!session) {
        sendJson(ctx, 404, { error: 'Session not found' });
        return;
      }
      sendJson(ctx, 200, { session });
    } catch {
      sendJson(ctx, 404, { error: 'Session not found' });
    }
  }, { summary: 'Get session by ID', tags: ['sessions'] });

  router.delete('/api/sessions/:id', async (ctx) => {
    if (!deps.sessions) {
      sendJson(ctx, 503, { error: 'Session manager not configured' });
      return;
    }
    await deps.sessions.deleteSession(ctx.params.id);
    sendJson(ctx, 200, { deleted: true });
  }, { summary: 'Delete session', tags: ['sessions'] });
}
