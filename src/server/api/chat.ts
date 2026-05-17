import type { Router, RouteContext } from '../router.js';
import { sendJson } from '../validation.js';
import type { AgentDeps } from '../../core/agent.js';
import { z } from 'zod';

const ChatRequestSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  model: z.string().optional(),
});

export function registerChatRoutes(router: Router, deps: AgentDeps): void {
  router.post('/api/chat', async (ctx) => {
    const parsed = ChatRequestSchema.safeParse(ctx.body);
    if (!parsed.success) {
      sendJson(ctx, 400, { error: 'Validation failed', details: parsed.error.issues });
      return;
    }

    const { message, model } = parsed.data;

    if (!deps.provider) {
      sendJson(ctx, 503, { error: 'No provider configured' });
      return;
    }

    try {
      const messages = [{ role: 'user' as const, content: message }];
      const response = await deps.provider.chat(messages);
      const content = typeof response === 'string' ? response : (response as any)?.content ?? String(response);

      sendJson(ctx, 200, {
        content,
        model: model ?? 'default',
        timestamp: Date.now(),
      });
    } catch (err) {
      sendJson(ctx, 500, { error: (err as Error).message });
    }
  }, {
    summary: 'Send a chat message',
    tags: ['chat'],
    requestBody: { description: 'Chat message payload' },
    responses: { 200: { description: 'Chat response' }, 400: { description: 'Invalid request' } },
  });

  router.post('/api/chat/stream', async (ctx) => {
    const parsed = ChatRequestSchema.safeParse(ctx.body);
    if (!parsed.success) {
      sendJson(ctx, 400, { error: 'Validation failed' });
      return;
    }

    if (!deps.provider) {
      sendJson(ctx, 503, { error: 'No provider configured' });
      return;
    }

    ctx.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      const messages = [{ role: 'user' as const, content: parsed.data.message }];
      if (deps.provider.chatStream) {
        for await (const chunk of deps.provider.chatStream(messages)) {
          if (ctx.res.writableEnded) break;
          ctx.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } else {
        const response = await deps.provider.chat(messages);
        const content = typeof response === 'string' ? response : String(response);
        ctx.res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
      }
    } catch (err) {
      ctx.res.write(`data: ${JSON.stringify({ type: 'error', error: (err as Error).message })}\n\n`);
    }

    if (!ctx.res.writableEnded) {
      ctx.res.write('data: [DONE]\n\n');
      ctx.res.end();
    }
  }, {
    summary: 'Stream a chat response',
    tags: ['chat'],
    responses: { 200: { description: 'SSE stream' } },
  });
}
