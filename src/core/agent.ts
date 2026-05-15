import { AgentLoop, type LoopEvent, type LoopOptions } from './loop.js';
import { ToolRegistry } from '../tools/registry.js';
import { ProviderRouter } from '../provider/router.js';
import { SessionManager } from '../session/manager.js';
import { HookSystem } from '../hooks/system.js';
import { ConfigManager } from '../config/manager.js';
import { MemorySystem } from '../memory/system.js';
import { SecurityManager } from '../security/manager.js';
import { MCPSession } from '../mcp/session.js';
import { SandboxManager } from '../sandbox/manager.js';
import { SkillSystem } from '../skills/system.js';
import type { PluginManager } from '../plugins/manager.js';
import { join } from 'node:path';

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
  ): AsyncGenerator<LoopEvent, void, void> {
    const sid = sessionId ?? this.deps.sessions.createSession();
    for await (const event of this.loop.run(message, sid, options)) {
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

  async destroy(): Promise<void> {
    if (this.deps.plugins) {
      await this.deps.plugins.deactivateAll();
    }
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
    tools.registerBatch(builtInTools.getBuiltinTools({ security, config, memory, sandbox }));

    const mcp = new MCPSession(config.getConfigDir());
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
