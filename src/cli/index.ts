#!/usr/bin/env node
import 'dotenv/config';
import chalk from 'chalk';
import { Command } from 'commander';
import { XiaobaiAgent } from '../core/agent.js';
import { Orchestrator } from '../core/orchestrator.js';
import { PricingTable } from '../core/pricing.js';
import { TokenTracker } from '../core/token-tracker.js';
import { RuntimeMetrics } from '../core/metrics.js';
import { StructuredLogger } from '../core/logger.js';
import { exportToJson, exportToMarkdown } from '../core/export.js';
import { ProviderHealthChecker } from '../provider/health.js';
import { DashboardServer } from '../server/index.js';
import { SkillSystem } from '../skills/system.js';
import { listRoles } from '../core/roles.js';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { Spinner, renderMarkdown, formatToolCall, formatTokenUsage, clearLine, printBanner, printHelp, formatCost, formatTokenSummary } from './renderer.js';
import { StreamingMarkdownRenderer } from './streaming-renderer.js';
import { PermissionPrompt } from './permissions.js';

const program = new Command();

program
  .name('xiaobai')
  .description('Xiaobai - A fusion AI agent combining the best of Hermes, OpenClaw, Claude Code, and Codex')
  .version('0.3.0');

program
  .command('chat')
  .description('Start an interactive chat session')
  .option('-m, --model <model>', 'Override default model')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('--sandbox <mode>', 'Sandbox mode: read-only | workspace-write | full-access')
  .option('--auto', 'Auto-approve all tool calls')
  .option('--dashboard [port]', 'Enable dashboard with optional port')
  .option('-r, --resume [sessionId]', 'Resume a previous session (latest if no ID given)')
  .action(async (options: Record<string, string>) => {
    printBanner();

    try {
      const agent = await XiaobaiAgent.create();
      const spinner = new Spinner();
      const permPrompt = new PermissionPrompt(options.auto ? 'auto' : 'default', agent.getDeps().security);
      const streamRenderer = new StreamingMarkdownRenderer();

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      permPrompt.setReadline(rl);

      let sessionId: string | undefined;
      let resumeFrom: string | undefined;
      let totalTokens = 0;
      let turnCount = 0;

      if (options.resume !== undefined) {
        const resumeId = typeof options.resume === 'string' && options.resume.length > 0
          ? options.resume
          : await agent.getDeps().sessions.getLatestSession();
        if (resumeId) {
          const state = await agent.getDeps().sessions.loadSessionState(resumeId);
          if (state) {
            resumeFrom = resumeId;
            sessionId = resumeId;
            turnCount = state.turn;
            totalTokens = state.totalTokens;
            console.log(chalk.cyan(`  Resumed session: ${resumeId}`));
            console.log(chalk.gray(`  ${state.messages.length} messages, ${state.turn} turns\n`));
          } else {
            console.log(chalk.yellow(`  Session not found: ${resumeId}. Starting new session.\n`));
            sessionId = agent.getDeps().sessions.createSession();
          }
        } else {
          console.log(chalk.yellow('  No previous sessions found. Starting new session.\n'));
          sessionId = agent.getDeps().sessions.createSession();
        }
      } else {
        sessionId = agent.getDeps().sessions.createSession();
      }

      const pricingTable = new PricingTable();
      const tokenTracker = new TokenTracker(pricingTable);

      let dashServer: DashboardServer | undefined;
      let chatListener: ((event: any) => void) | undefined;

      if (options.dashboard) {
        const port = parseInt(options.dashboard, 10) || 3001;
        dashServer = new DashboardServer({ port });
        await dashServer.start();
        chatListener = dashServer.getBridge().createChatListener('default');
        console.log(chalk.gray(`  Dashboard: ${dashServer.getHttpUrl()}\n`));
      }

      const prompt = () => {
        rl.question(chalk.green('> '), async (input) => {
          const trimmed = input.trim();
          if (!trimmed) { prompt(); return; }

          if (trimmed === '/exit' || trimmed === '/quit') {
            console.log(chalk.gray(`\n  Turns: ${turnCount}, Tokens: ${formatTokenUsage(totalTokens)}`));
            const tokenSummary = tokenTracker.getSummary();
            if (tokenSummary.totalTokens > 0) {
              console.log(formatTokenSummary(tokenSummary));
            }
            console.log(chalk.gray('  Goodbye!\n'));
            if (dashServer) await dashServer.stop();
            rl.close();
            process.exit(0);
            return; // unreachable in production, prevents fallthrough in tests
          }

          if (trimmed === '/help') { printHelp(); prompt(); return; }

          if (trimmed === '/memory') {
            const usage = agent.getMemory().getUsage();
            console.log(chalk.yellow(`\n  Memory: ${usage.memory.used}/${usage.memory.limit} chars`));
            console.log(chalk.yellow(`  User:   ${usage.user.used}/${usage.user.limit} chars\n`));
            prompt();
            return;
          }

          if (trimmed === '/tools') {
            const tools = agent.getTools().list();
            console.log(chalk.yellow(`\n  Tools (${tools.length}):`));
            tools.forEach((t) => console.log(chalk.gray(`    - ${t}`)));
            console.log();
            prompt();
            return;
          }

          if (trimmed === '/clear') {
            sessionId = undefined;
            totalTokens = 0;
            turnCount = 0;
            console.log(chalk.gray('  Session cleared.\n'));
            prompt();
            return;
          }

          if (trimmed === '/compact') {
            console.log(chalk.gray('  Compaction is automatic. Use /clear to reset.\n'));
            prompt();
            return;
          }

          if (trimmed === '/sessions') {
            const sessions = await agent.getDeps().sessions.listSessions?.() ?? [];
            if (sessions.length === 0) {
              console.log(chalk.gray('  No saved sessions.\n'));
            } else {
              console.log(chalk.yellow(`\n  Sessions (${sessions.length}):`));
              sessions.slice(0, 10).forEach((s: any) => {
                const age = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : 'unknown';
                console.log(chalk.gray(`    ${s.id} (${s.messageCount} msgs, ${age})`));
              });
              console.log();
            }
            prompt();
            return;
          }

          if (trimmed.startsWith('/model')) {
            const parts = trimmed.trim().split(/\s+/);
            const current = agent.getCurrentModel();

            if (parts.length === 1) {
              console.log(chalk.cyan(`  Provider: ${current.provider}`));
              console.log(chalk.cyan(`  Model:    ${current.model}\n`));
            } else if (parts.length === 2) {
              agent.setModel(parts[1]);
              const updated = agent.getCurrentModel();
              console.log(chalk.green(`  Switched to provider: ${updated.provider}\n`));
            } else {
              agent.setModel(parts[1], parts[2]);
              console.log(chalk.green(`  Switched to ${parts[1]}/${parts[2]}\n`));
            }
            prompt();
            return;
          }

          if (trimmed.startsWith('/export')) {
            const format = trimmed.split(/\s+/)[1] ?? 'markdown';
            if (!sessionId) {
              console.log(chalk.yellow('  No active session to export.\n'));
              prompt();
              return;
            }
            const state = await agent.getDeps().sessions.loadSessionState(sessionId);
            if (!state) {
              console.log(chalk.yellow('  Session state not found.\n'));
              prompt();
              return;
            }
            const tokenSummary = tokenTracker.getSummary();
            const data = {
              version: '0.4.0',
              exportedAt: new Date().toISOString(),
              session: {
                id: sessionId,
                messages: state.messages,
                turnCount: turnCount,
                startedAt: new Date(state.createdAt).toISOString(),
                completedAt: new Date().toISOString(),
              },
              tokenUsage: tokenSummary.totalTokens > 0 ? tokenSummary : undefined,
            };
            if (format === 'json') {
              console.log(exportToJson(data));
            } else {
              console.log(exportToMarkdown(data));
            }
            console.log();
            prompt();
            return;
          }

          if (trimmed === '/metrics') {
            console.log(chalk.cyan('\n  Runtime Metrics:'));
            console.log(chalk.gray(`    Turns: ${turnCount}`));
            console.log(chalk.gray(`    Tokens: ${formatTokenUsage(totalTokens)}`));
            const tokenSummary = tokenTracker.getSummary();
            if (tokenSummary.totalTokens > 0) {
              console.log(chalk.gray(`    Cost: ${formatCost(tokenSummary.totalCost)}`));
            }
            console.log();
            prompt();
            return;
          }

          if (trimmed === '/health') {
            const healthChecker = new ProviderHealthChecker(agent.getDeps().provider, agent.getDeps().config.get());
            const results = await healthChecker.checkAll();
            console.log(chalk.cyan('\n  Provider Health:'));
            for (const r of results) {
              const icon = r.status === 'healthy' ? chalk.green('✓') : r.status === 'degraded' ? chalk.yellow('⚠') : r.status === 'unhealthy' ? chalk.red('✗') : chalk.gray('?');
              console.log(`    ${icon} ${r.provider}: ${r.status} (${r.latencyMs}ms)${r.error ? ` - ${r.error}` : ''}`);
            }
            console.log();
            prompt();
            return;
          }

          // Normal chat
          spinner.start('Thinking...');
          turnCount++;
          streamRenderer.reset();

          try {
            let currentTool = '';
            let toolArgs: Record<string, unknown> = {};

            for await (const event of agent.chat(trimmed, sessionId, {
              stream: true,
              permissionCallback: (tool, args) => permPrompt.checkPermission(tool, args),
              tokenTracker,
            }, resumeFrom)) {
              chatListener?.(event);
              switch (event.type) {
                case 'text':
                  spinner.stop();
                  process.stdout.write(renderMarkdown(event.content));
                  break;

                case 'stream':
                  spinner.stop();
                  streamRenderer.push(event.content);
                  break;

                case 'tool_call':
                  currentTool = event.toolName ?? '';
                  toolArgs = event.toolArgs ?? {};
                  spinner.start(`Running ${currentTool}...`);
                  break;

                case 'tool_result':
                  spinner.stop();
                  console.log(formatToolCall({
                    name: (currentTool || event.toolName) ?? 'unknown',
                    args: toolArgs,
                    result: event.result ? { success: event.result.success, output: event.result.output } : undefined,
                  }));
                  currentTool = '';
                  break;

                case 'compact':
                  spinner.start('Compressing context...');
                  break;

                case 'stop':
                  spinner.stop();
                  streamRenderer.flush();
                  if (event.tokens) totalTokens += event.tokens;
                  const summary = tokenTracker.getSummary();
                  console.log(chalk.gray(`  Tokens: ${formatTokenUsage(summary.totalTokens)} | Cost: ${formatCost(summary.totalCost)}`));
                  console.log(); // newline after response
                  break;

                case 'error':
                  spinner.stop();
                  console.log(chalk.red(`  Error: ${event.content}`));
                  break;
              }

            }

            // Save session state after each turn
            if (sessionId) {
              await agent.getDeps().sessions.saveSessionState(sessionId, {
                sessionId,
                turn: turnCount,
                totalTokens,
              });
            }
            // Clear resumeFrom so subsequent messages use normal flow
            resumeFrom = undefined;
          } catch (error) {
            spinner.stop();
            console.log(chalk.red(`\n  Error: ${(error as Error).message}`));
          }

          prompt();
        });
      };

      prompt();
    } catch (error) {
      console.error(chalk.red('Failed to start:'), (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('exec <prompt>')
  .description('Execute a single prompt and exit')
  .option('-m, --model <model>', 'Override default model')
  .option('--stream', 'Stream output in real-time')
  .option('--dashboard [port]', 'Enable dashboard with optional port')
  .action(async (prompt: string, options: Record<string, string>) => {
    let dashServer: DashboardServer | undefined;
    try {
      const agent = await XiaobaiAgent.create();
      const spinner = new Spinner();
      let chatListener: ((event: any) => void) | undefined;

      if (options.dashboard) {
        const port = parseInt(options.dashboard, 10) || 3001;
        dashServer = new DashboardServer({ port });
        await dashServer.start();
        chatListener = dashServer.getBridge().createChatListener('exec');
        console.log(chalk.gray(`Dashboard: ${dashServer.getHttpUrl()}`));
      }

      if (options.stream) {
        spinner.start('Thinking...');
        for await (const event of agent.chat(prompt, undefined, { stream: true })) {
          chatListener?.(event);
          if (event.type === 'text' || event.type === 'stream') {
            spinner.stop();
            process.stdout.write(renderMarkdown(event.content));
          } else if (event.type === 'tool_result') {
            spinner.stop();
            console.log(chalk.gray(`  [${event.toolName}] ${event.result?.success ? '✓' : '✗'}`));
          } else if (event.type === 'stop') {
            spinner.stop();
            console.log();
          } else if (event.type === 'error') {
            spinner.stop();
            console.log(chalk.red(`Error: ${event.content}`));
          }
        }
      } else {
        const response = await agent.chatSync(prompt);
        console.log(renderMarkdown(response));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), (error as Error).message);
      process.exit(1);
    } finally {
      if (dashServer) await dashServer.stop();
    }
  });

program
  .command('memory')
  .description('Manage persistent memory')
  .addCommand(
    new Command('list')
      .description('List all memory entries')
      .action(async () => {
        const agent = await XiaobaiAgent.create();
        const mem = agent.getMemory().list('memory');
        const user = agent.getMemory().list('user');
        console.log(chalk.cyan('\nMemory:'));
        mem.forEach((e) => console.log(`  ${e}`));
        console.log(chalk.cyan('\nUser Profile:'));
        user.forEach((e) => console.log(`  ${e}`));
      }),
  );

program
  .command('config')
  .description('View or manage configuration')
  .addCommand(
    new Command('show')
      .description('Show current configuration')
      .action(async () => {
        const { ConfigManager } = await import('../config/manager.js');
        const config = new ConfigManager();
        console.log(JSON.stringify(config.get(), null, 2));
      }),
  );

program
  .command('dashboard')
  .description('Start the real-time agent dashboard')
  .option('-p, --port <port>', 'Server port', '3001')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (options: { port: string; open: boolean }) => {
    const port = parseInt(options.port, 10);

    const server = new DashboardServer({ port, staticDir: undefined });
    await server.start();

    const httpUrl = server.getHttpUrl();
    const wsUrl = server.getUrl();

    console.log(chalk.cyan.bold('\n  Xiaobai Dashboard'));
    console.log(chalk.gray(`  HTTP:  ${httpUrl}`));
    console.log(chalk.gray(`  WS:    ${wsUrl}`));
    console.log(chalk.gray(`  Health: ${httpUrl}/health\n`));

    if (options.open) {
      const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      execFile(cmd, [httpUrl]);
    }

    process.on('SIGINT', async () => {
      console.log(chalk.gray('\nShutting down...'));
      await server.stop();
      process.exit(0);
    });
  });

program
  .command('run <prompt>')
  .description('Run a task through the multi-agent orchestrator')
  .option('-r, --role <role>', 'Agent role to use', 'coordinator')
  .option('-p, --port <port>', 'Dashboard port (starts dashboard if set)', '')
  .option('-c, --concurrency <n>', 'Max concurrent agents', '3')
  .action(async (prompt: string, options: { role: string; port: string; concurrency: string }) => {
    let server: DashboardServer | undefined;
    const spinner = new Spinner();

    try {
      const agent = await XiaobaiAgent.create();

      if (options.port) {
        server = new DashboardServer({ port: parseInt(options.port, 10) });
        await server.start();
        console.log(chalk.gray(`Dashboard: ${server.getHttpUrl()}`));
      }

      const agentDeps = agent.getDeps();
      const orch = new Orchestrator({
        config: agentDeps.config,
        provider: agentDeps.provider,
        tools: agentDeps.tools,
        sessions: agentDeps.sessions,
        hooks: agentDeps.hooks,
        memory: agentDeps.memory,
        security: agentDeps.security,
      });

      if (server) server.attachOrchestrator(orch);

      orch.addTask({ description: prompt, role: options.role });

      const events: string[] = [];
      orch.onEvent((event) => {
        switch (event.type) {
          case 'task_started':
            spinner.start(`Agent ${event.agentId}: ${event.task?.description?.slice(0, 50)}...`);
            events.push(`[${event.agentId}] Started: ${event.task?.description?.slice(0, 60)}`);
            break;
          case 'task_completed':
            spinner.succeed(`${event.task?.description?.slice(0, 50)} (${event.result?.tokensUsed ?? 0} tokens)`);
            events.push(`[done] ${event.task?.description?.slice(0, 60)} (${event.result?.tokensUsed ?? 0} tokens)`);
            break;
          case 'task_failed':
            spinner.fail(`${event.error}`);
            events.push(`[fail] ${event.error}`);
            break;
        }
      });

      console.log(chalk.cyan(`\nRunning: "${prompt}"`));
      console.log(chalk.gray(`Role: ${options.role}, Concurrency: ${options.concurrency}\n`));

      const results = await orch.execute({ maxConcurrency: parseInt(options.concurrency, 10) });

      console.log(chalk.cyan('\n--- Results ---'));
      for (const result of results) {
        const icon = result.success ? chalk.green('✓') : chalk.red('✗');
        console.log(`${icon} ${result.taskId}: ${result.output.slice(0, 200)}`);
        if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
      }

      console.log(chalk.gray(`\nTotal tokens: ${formatTokenUsage(results.reduce((sum, r) => sum + r.tokensUsed, 0))}`));
    } catch (error) {
      spinner.stop();
      console.error(chalk.red('Error:'), (error as Error).message);
      process.exit(1);
    } finally {
      if (server) await server.stop();
    }
  });

program
  .command('agents')
  .description('List available agent roles')
  .action(() => {
    const roles = listRoles();
    console.log(chalk.cyan.bold('\n  Available Agent Roles\n'));
    for (const role of roles) {
      const tools = role.allowedTools === '*' ? 'all' : (role.allowedTools as string[]).join(', ');
      console.log(`  ${chalk.yellow(role.id.padEnd(14))} ${role.name}`);
      console.log(`  ${' '.repeat(14)} ${chalk.gray(role.description)}`);
      console.log(`  ${' '.repeat(14)} Tools: ${chalk.gray(tools)}`);
      console.log(`  ${' '.repeat(14)} Max turns: ${chalk.gray(String(role.maxTurns ?? 'default'))}`);
      console.log();
    }
  });

program
  .command('skills')
  .description('Manage skills')
  .addCommand(
    new Command('list')
      .description('List installed skills')
      .action(async () => {
        const agent = await XiaobaiAgent.create();
        const skills = agent.getSkills();
        if (!skills) {
          console.log(chalk.gray('Skills system not enabled.'));
          return;
        }
        const list = skills.listSkills();
        if (list.length === 0) {
          console.log(chalk.gray('No skills installed. Create one with: xiaobai skills create <name>'));
          return;
        }
        console.log(chalk.cyan.bold(`\n  Installed Skills (${list.length})\n`));
        for (const skill of list) {
          const src = skill.source === 'builtin' ? chalk.blue('[builtin]') :
            skill.source === 'installed' ? chalk.magenta('[installed]') :
            chalk.green('[user]');
          console.log(`  ${src} ${chalk.yellow(skill.name.padEnd(20))} ${chalk.gray(skill.category)} ${skill.description}`);
        }
        console.log();
      }),
  )
  .addCommand(
    new Command('create <name>')
      .description('Create a new skill from template')
      .option('-d, --description <desc>', 'Skill description', '')
      .option('-c, --category <cat>', 'Skill category', 'general')
      .action(async (name: string, options: { description: string; category: string }) => {
        const agent = await XiaobaiAgent.create();
        const skills = agent.getSkills();
        if (!skills) { console.log(chalk.red('Skills not enabled.')); return; }
        const desc = options.description || `${name} skill`;
        await skills.create(name, desc, options.category as any);
        console.log(chalk.green(`  Created skill: ${name}`));
        console.log(chalk.gray(`  Edit at: ~/.xiaobai/default/skills/${name}/SKILL.md`));
      }),
  )
  .addCommand(
    new Command('show <name>')
      .description('Show skill content')
      .action(async (name: string) => {
        const agent = await XiaobaiAgent.create();
        const skills = agent.getSkills();
        const skill = skills?.getSkill(name);
        if (!skill) { console.log(chalk.red(`  Skill not found: ${name}`)); return; }
        console.log(chalk.cyan.bold(`\n  ${skill.name} (${skill.category}) v${skill.version}`));
        console.log(chalk.gray(`  ${skill.description}\n`));
        console.log(skill.content);
        console.log();
      }),
  )
  .addCommand(
    new Command('install <url>')
      .description('Install a skill from URL')
      .option('-n, --name <name>', 'Override skill name')
      .action(async (url: string, options: { name?: string }) => {
        const agent = await XiaobaiAgent.create();
        const skills = agent.getSkills();
        if (!skills) { console.log(chalk.red('Skills not enabled.')); return; }
        console.log(chalk.gray(`  Installing from: ${url}`));
        const skill = await skills.installFromUrl(url, options.name);
        if (skill) {
          console.log(chalk.green(`  Installed: ${skill.name}`));
        } else {
          console.log(chalk.red('  Failed to install skill.'));
        }
      }),
  )
  .addCommand(
    new Command('search <query>')
      .description('Search installed skills')
      .action(async (query: string) => {
        const agent = await XiaobaiAgent.create();
        const skills = agent.getSkills();
        if (!skills) { console.log(chalk.red('Skills not enabled.')); return; }
        const results = skills.search(query);
        if (results.length === 0) {
          console.log(chalk.gray('  No matching skills found.'));
          return;
        }
        console.log(chalk.cyan.bold(`\n  Search Results (${results.length})\n`));
        for (const skill of results) {
          console.log(`  ${chalk.yellow(skill.name.padEnd(20))} ${skill.description}`);
        }
        console.log();
      }),
  )
  .addCommand(
    new Command('install-builtin')
      .description('Install built-in skill templates')
      .argument('[name]', 'Skill name (installs all if omitted)')
      .action(async (name?: string) => {
        const agent = await XiaobaiAgent.create();
        const skills = agent.getSkills();
        if (!skills) { console.log(chalk.red('Skills not enabled.')); return; }
        const installed = await skills.installBuiltin(name);
        if (installed.length === 0) {
          console.log(chalk.gray('  All built-in skills already installed or none found.'));
        } else {
          for (const s of installed) {
            console.log(chalk.green(`  Installed: ${s}`));
          }
        }
      }),
  )
  .addCommand(
    new Command('builtins')
      .description('List available built-in skill templates')
      .action(() => {
        const names = SkillSystem.listBuiltinNames();
        console.log(chalk.cyan.bold(`\n  Built-in Skill Templates (${names.length})\n`));
        for (const name of names) {
          console.log(`  ${chalk.yellow(name)}`);
        }
        console.log(chalk.gray('\n  Install with: xiaobai skills install-builtin [name]\n'));
      }),
  );

program
  .command('plugins')
  .description('Manage plugins')
  .addCommand(
    new Command('list')
      .description('List installed plugins')
      .action(async () => {
        const agent = await XiaobaiAgent.create();
        const plugins = agent.getPlugins();
        if (!plugins) {
          console.log(chalk.gray('Plugins system not enabled.'));
          return;
        }
        const list = plugins.list();
        if (list.length === 0) {
          console.log(chalk.gray('No plugins installed. Create one with: xiaobai plugins create <name>'));
          return;
        }
        console.log(chalk.cyan.bold(`\n  Installed Plugins (${list.length})\n`));
        for (const info of list) {
          const stateColor = info.state === 'activated' ? chalk.green :
            info.state === 'error' ? chalk.red : chalk.gray;
          console.log(`  ${chalk.yellow(info.name.padEnd(20))} ${stateColor(info.state.padEnd(14))} v${info.version} ${chalk.gray(info.description)}`);
        }
        console.log();
      }),
  )
  .addCommand(
    new Command('create <name>')
      .description('Scaffold a new plugin')
      .option('-d, --description <desc>', 'Plugin description', '')
      .action(async (name: string, options: { description: string }) => {
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { homedir } = await import('node:os');
        const dir = join(homedir(), '.xiaobai', 'default', 'plugins', name);
        const desc = options.description || `${name} plugin`;
        mkdirSync(dir, { recursive: true });

        writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
          name,
          version: '1.0.0',
          description: desc,
          permissions: ['tools:register', 'hooks:subscribe'],
        }, null, 2));

        writeFileSync(join(dir, 'index.js'), `export default {
  manifest: ${JSON.stringify({ name, version: '1.0.0', description: desc, permissions: ['tools:register', 'hooks:subscribe'] })},

  async init(api) {
    api.logger.info('Plugin initialized');
  },

  async activate() {
    // Register tools, hooks, providers here
  },

  async deactivate() {
    // Cleanup here
  },
};
`);

        console.log(chalk.green(`  Created plugin: ${name}`));
        console.log(chalk.gray(`  Directory: ${dir}`));
        console.log(chalk.gray(`  Edit plugin.json and index.js to customize.`));
      }),
  )
  .addCommand(
    new Command('install <source>')
      .description('Install a plugin from a local directory')
      .action(async (source: string) => {
        const agent = await XiaobaiAgent.create();
        const plugins = agent.getPlugins();
        if (!plugins) { console.log(chalk.red('Plugins not enabled.')); return; }
        try {
          await plugins.install(source);
          console.log(chalk.green(`  Installed plugin from: ${source}`));
        } catch (err) {
          console.log(chalk.red(`  ${(err as Error).message}`));
        }
      }),
  )
  .addCommand(
    new Command('uninstall <name>')
      .description('Uninstall a plugin')
      .action(async (name: string) => {
        const agent = await XiaobaiAgent.create();
        const plugins = agent.getPlugins();
        if (!plugins) { console.log(chalk.red('Plugins not enabled.')); return; }
        await plugins.uninstall(name);
        console.log(chalk.green(`  Uninstalled plugin: ${name}`));
      }),
  );

export { program };

if (!process.env.VITEST) program.parse();
