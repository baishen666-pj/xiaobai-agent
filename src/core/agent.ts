import { AgentLoop, type LoopEvent, type LoopOptions } from './loop.js';
import { ToolRegistry } from '../tools/registry.js';
import { ProviderRouter } from '../provider/router.js';
import { SessionManager } from '../session/manager.js';
import { HookSystem } from '../hooks/system.js';
import { ConfigManager } from '../config/manager.js';
import { MemorySystem } from '../memory/system.js';
import { SecurityManager } from '../security/manager.js';
import { MCPSession, createMCPTools } from '../mcp/session.js';
import { SandboxManager } from '../sandbox/manager.js';
import { SkillSystem } from '../skills/system.js';
import { KnowledgeBase } from '../memory/knowledge-base.js';
import type { VectorStoreAdapter } from '../memory/vector-store.js';
import type { PluginManager } from '../plugins/manager.js';
import type { XiaobaiConfig } from '../config/manager.js';
import { join } from 'node:path';
import { FileWatcher, type FileWatcherOptions } from '../tools/file-watcher.js';

export interface AgentDeps {
  config: ConfigManager;
  provider: ProviderRouter;
  tools: ToolRegistry;
  sessions: SessionManager;
  hooks: HookSystem;
  memory: MemorySystem;
  security: SecurityManager;
  mcp?: MCPSession;
  sandbox?: SandboxManager;
  skills?: SkillSystem;
  plugins?: PluginManager;
}

export class XiaobaiAgent {
  private loop: AgentLoop;
  private deps: AgentDeps;
  private watcher?: FileWatcher;
  private knowledge?: KnowledgeBase;

  constructor(deps: AgentDeps, knowledge?: KnowledgeBase) {
    this.knowledge = knowledge;
    this.deps = deps;
    this.loop = new AgentLoop({
      provider: deps.provider,
      tools: deps.tools,
      sessions: deps.sessions,
      hooks: deps.hooks,
      config: deps.config,
      memory: deps.memory,
      security: deps.security,
      skills: deps.skills,
      knowledge,
    });
  }

  async *chat(
    message: string,
    sessionId?: string,
    options?: LoopOptions,
    resumeFrom?: string,
  ): AsyncGenerator<LoopEvent, void, void> {
    const sid = sessionId ?? resumeFrom ?? this.deps.sessions.createSession();

    let initialState: Partial<import('./loop.js').LoopState> | undefined;
    if (resumeFrom) {
      const sessionState = await this.deps.sessions.loadSessionState(resumeFrom);
      if (sessionState) {
        initialState = {
          turn: sessionState.turn,
          messages: sessionState.messages,
          totalTokens: sessionState.totalTokens,
          lastCompactTokens: sessionState.lastCompactTokens,
        };
      }
    }

    for await (const event of this.loop.run(message, sid, options, initialState)) {
      yield event;
    }
  }

  async chatSync(message: string, sessionId?: string): Promise<string> {
    const sid = sessionId ?? this.deps.sessions.createSession();
    const parts: string[] = [];
    for await (const event of this.loop.run(message, sid)) {
      if (event.type === 'text') {
        parts.push(event.content);
      }
    }
    return parts.join('');
  }

  getTools(): ToolRegistry {
    return this.deps.tools;
  }

  getMemory(): MemorySystem {
    return this.deps.memory;
  }

  getHooks(): HookSystem {
    return this.deps.hooks;
  }

  getSecurity(): SecurityManager {
    return this.deps.security;
  }

  getSkills(): SkillSystem | undefined {
    return this.deps.skills;
  }

  getPlugins(): PluginManager | undefined {
    return this.deps.plugins;
  }

  getKnowledge(): KnowledgeBase | undefined {
    return this.knowledge;
  }

  getDeps(): AgentDeps {
    return this.deps;
  }

  getCurrentModel(): { provider: string; model: string } {
    const cfg = this.deps.config.get();
    return { provider: cfg.provider.default, model: cfg.model.default };
  }

  setModel(provider?: string, model?: string): void {
    if (!provider && !model) return;
    this.deps.provider.updateConfig({
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    });
  }

  async destroy(): Promise<void> {
    this.watcher?.stop();
    if (this.deps.plugins) {
      await this.deps.plugins.deactivateAll();
    }
    if (this.deps.mcp) {
      await this.deps.mcp.disconnectAll();
    }
  }

  startWatcher(options: Omit<FileWatcherOptions, 'rootDir'> & { rootDir?: string }): FileWatcher | undefined {
    if (this.watcher) this.watcher.stop();
    const rootDir = options.rootDir ?? process.cwd();
    this.watcher = new FileWatcher({ ...options, rootDir });
    this.watcher.start();
    return this.watcher;
  }

  static async create(configDir?: string): Promise<XiaobaiAgent> {
    const config = new ConfigManager();
    const cfg = config.get();

    const provider = new ProviderRouter(cfg);
    const sessions = new SessionManager(config.getConfigDir());
    const hooks = new HookSystem(config.getConfigDir());
    const memory = new MemorySystem(config.getConfigDir());
    const security = new SecurityManager(cfg);
    const sandbox = new SandboxManager(cfg.sandbox);
    const tools = new ToolRegistry();

    const builtInTools = await import('../tools/builtin.js');

    // Initialize knowledge base (non-fatal)
    const needsExternalAdapter = cfg.persistence?.adapter === 'chroma' || cfg.persistence?.adapter === 'qdrant';
    const vectorAdapter = needsExternalAdapter ? await createVectorAdapter(cfg) : undefined;
    const kb = new KnowledgeBase(provider, {
      knowledgeDir: join(config.getConfigDir(), 'knowledge'),
      ...(vectorAdapter ? { vectorAdapter } : {}),
    });

    tools.registerBatch(builtInTools.getBuiltinTools({ security, config, memory, sandbox, tools, knowledge: kb }));

    const mcp = new MCPSession(config.getConfigDir());

    // Auto-discover and register MCP tools (non-fatal)
    const mcpPromise = (async () => {
      try {
        const mcpTools = await mcp.discoverTools();
        for (const [serverName, toolDefs] of mcpTools) {
          const mcpToolInstances = createMCPTools(serverName, toolDefs, mcp);
          for (const tool of mcpToolInstances) {
            tools.registerMcpTool(serverName, tool);
          }
        }
      } catch (e) {
        console.debug('agent: MCP discovery failure (non-fatal)', (e as Error).message);
      }
    })();

    const skills = new SkillSystem(config.getConfigDir());
    const skillsPromise = cfg.skills.enabled ? skills.loadAll() : Promise.resolve();

    const pluginsPromise = (async (): Promise<PluginManager | undefined> => {
      if (!cfg.plugins?.enabled) return undefined;
      const { PluginManager } = await import('../plugins/manager.js');
      const pluginsDir = join(config.getConfigDir(), 'plugins');
      const pm = new PluginManager({
        tools,
        hooks,
        config,
        memory,
        providers: provider,
        pluginsDir,
      });
      await pm.init();
      await pm.activateAll();
      return pm;
    })();

    const kbPromise = (async () => {
      try {
        await kb.loadAll();
      } catch (e) {
        console.debug('agent: Knowledge base load failure (non-fatal)', (e as Error).message);
      }
    })();

    const [, , plugins] = await Promise.all([mcpPromise, skillsPromise, pluginsPromise, kbPromise]);

    return new XiaobaiAgent({
      config,
      provider,
      tools,
      sessions,
      hooks,
      memory,
      security,
      mcp,
      sandbox,
      skills,
      plugins,
    }, kb);
  }
}

async function createVectorAdapter(cfg: XiaobaiConfig): Promise<VectorStoreAdapter> {
  const p = cfg.persistence;
  if (p?.adapter === 'chroma') {
    const { ChromaDBAdapter } = await import('../memory/adapters/chroma-adapter.js');
    return new ChromaDBAdapter({
      baseUrl: p.chromaUrl,
      collection: p.chromaCollection ?? 'xiaobai_vectors',
    });
  }
  if (p?.adapter === 'qdrant') {
    const { QdrantAdapter } = await import('../memory/adapters/qdrant-adapter.js');
    return new QdrantAdapter({
      baseUrl: p.qdrantUrl,
      collection: p.qdrantCollection ?? 'xiaobai_vectors',
    });
  }
  throw new Error(`Unknown persistence adapter: ${p?.adapter}`);
}
