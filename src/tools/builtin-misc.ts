import type { Tool, ToolContext, ToolResult } from './registry.js';

export interface ToolContextExtended extends ToolContext {
  memory?: import('../memory/system.js').MemorySystem;
  sandbox?: import('../sandbox/manager.js').SandboxManager;
  provider?: import('../provider/router.js').ProviderRouter;
  sessions?: import('../session/manager.js').SessionManager;
  hooks?: import('../hooks/system.js').HookSystem;
  skills?: import('../skills/system.js').SkillSystem;
}

export const memoryTool = (context?: ToolContext): Tool => ({
  definition: {
    name: 'memory',
    description: 'Manage persistent memory across sessions',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'replace', 'remove', 'list'],
          description: 'Action to perform',
        },
        target: {
          type: 'string',
          enum: ['memory', 'user'],
          description: 'Memory store target',
        },
        content: { type: 'string', description: 'Content to add or replace with' },
        old_text: { type: 'string', description: 'Substring to match for replace/remove' },
      },
      required: ['action', 'target'],
    },
  },
  async execute(args): Promise<ToolResult> {
    const { action, target, content, old_text } = args as {
      action: 'add' | 'replace' | 'remove' | 'list';
      target: 'memory' | 'user';
      content?: string;
      old_text?: string;
    };

    if (!context?.memory) {
      return { output: 'Memory system not available', success: false, error: 'no_memory' };
    }

    const mem = context.memory;

    switch (action) {
      case 'add': {
        if (!content) return { output: 'content is required for add', success: false, error: 'missing_content' };
        const result = mem.add(target, content);
        return {
          output: result.success ? `Added to ${target} memory` : `Failed: ${result.error}`,
          success: result.success,
          error: result.error,
        };
      }
      case 'replace': {
        if (!old_text || !content) {
          return { output: 'old_text and content are required for replace', success: false, error: 'missing_params' };
        }
        const result = mem.replace(target, old_text, content);
        return {
          output: result.success ? `Replaced in ${target} memory` : `Failed: ${result.error}`,
          success: result.success,
          error: result.error,
        };
      }
      case 'remove': {
        if (!old_text) return { output: 'old_text is required for remove', success: false, error: 'missing_params' };
        const result = mem.remove(target, old_text);
        return {
          output: result.success ? `Removed from ${target} memory` : `Failed: ${result.error}`,
          success: result.success,
          error: result.error,
        };
      }
      case 'list': {
        const entries = mem.list(target);
        return {
          output: entries.length > 0 ? entries.join('\n') : `${target} memory is empty`,
          success: true,
        };
      }
    }
  },
});

export function createAgentTool(context?: ToolContextExtended): Tool {
  return {
    definition: {
      name: 'agent',
      description: 'Spawn a sub-agent with isolated context. Supports explore, plan, and general-purpose modes. Sub-agents cannot spawn further agents (max depth 1).',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Task description for the sub-agent' },
          type: {
            type: 'string',
            enum: ['explore', 'plan', 'general-purpose'],
            description: 'Agent type: explore (research only), plan (architect only), general-purpose (full tools)',
            default: 'general-purpose',
          },
        },
        required: ['prompt'],
      },
    },
    async execute(args, toolContext): Promise<ToolResult> {
      const prompt = args.prompt as string;
      const type = (args.type as string) ?? 'general-purpose';

      const { SubAgentEngine } = await import('../core/sub-agent.js');
      const { ToolRegistry } = await import('./registry.js');

      const ctx = toolContext ?? context ?? {};
      const deps = {
        provider: (ctx as Record<string, unknown>).provider,
        sessions: (ctx as Record<string, unknown>).sessions,
        hooks: (ctx as Record<string, unknown>).hooks,
        config: (ctx as Record<string, unknown>).config ?? toolContext?.config,
        memory: (ctx as Record<string, unknown>).memory ?? toolContext?.memory,
        security: (ctx as Record<string, unknown>).security ?? toolContext?.security,
        skills: (ctx as Record<string, unknown>).skills,
      };
      const subEngine = new SubAgentEngine(deps as ConstructorParameters<typeof SubAgentEngine>[0]);

      const typeToDef: Record<string, string | undefined> = {
        explore: 'explore',
        plan: 'plan',
      };

      const result = await subEngine.spawn(prompt, new ToolRegistry(), {
        definitionName: typeToDef[type],
      });

      subEngine.destroy();

      return {
        output: result.success
          ? result.output
          : `Sub-agent failed: ${result.error}`,
        success: result.success,
        metadata: {
          tokensUsed: result.tokensUsed,
          toolCalls: result.toolCalls,
        },
      };
    },
  };
}