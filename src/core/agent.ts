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
import type { PluginManager } from '../plugins/manager.js';
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

  constructor(deps: AgentDeps) {
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
    let response = '';
    for await (const event of this.loop.run(message, sid)) {
      if (event.type === 'text') {
        response += event.content;
      }
    }
    return response;
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
    tools.registerBatch(builtInTools.getBuiltinTools({ security, config, memory, sandbox, tools }));

    const mcp = new MCPSession(config.getConfigDir());

    // Auto-discover and register MCP tools (non-fatal)
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

    const skills = new SkillSystem(config.getConfigDir());
    if (cfg.skills.enabled) {
      await skills.loadAll();
    }

    let plugins: PluginManager | undefined;
    if (cfg.plugins?.enabled) {
      const { PluginManager } = await import('../plugins/manager.js');
      const pluginsDir = join(config.getConfigDir(), 'plugins');
      plugins = new PluginManager({
        tools,
        hooks,
        config,
        memory,
        providers: provider,
        pluginsDir,
      });
      await plugins.init();
      await plugins.activateAll();
    }

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
    });
  }
}
