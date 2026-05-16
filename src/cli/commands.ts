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
import { SkillSystem, type SkillCategory } from '../skills/system.js';
import { listRoles } from '../core/roles.js';
import type { LoopEvent } from '../core/loop.js';
import { execFile } from 'node:child_process';
import { Spinner, renderMarkdown, formatToolCall, formatTokenUsage, clearLine, formatCost, formatTokenSummary } from './renderer.js';

export function registerExecCommand(program: Command): Command {
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
        let chatListener: ((event: LoopEvent) => void) | undefined;

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

  return program;
}

export function registerMemoryCommand(program: Command): Command {
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

  return program;
}

export function registerConfigCommand(program: Command): Command {
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

  return program;
}

export function registerDashboardCommand(program: Command): Command {
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

  return program;
}

export function registerRunCommand(program: Command): Command {
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

  return program;
}

export function registerAgentsCommand(program: Command): Command {
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

  return program;
}

export function registerSkillsCommand(program: Command): Command {
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
          await skills.create(name, desc, options.category as SkillCategory);
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

  return program;
}

export function registerPluginsCommand(program: Command): Command {
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

  return program;
}