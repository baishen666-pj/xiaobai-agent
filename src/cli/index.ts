#!/usr/bin/env node
import { Command } from 'commander';
import { XiaobaiAgent } from '../core/agent.js';
import { Orchestrator } from '../core/orchestrator.js';
import { DashboardServer } from '../server/index.js';
import { listRoles } from '../core/roles.js';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { exec } from 'node:child_process';

const program = new Command();

program
  .name('xiaobai')
  .description('Xiaobai - A fusion AI agent combining the best of Hermes, OpenClaw, Claude Code, and Codex')
  .version('0.1.0');

program
  .command('chat')
  .description('Start an interactive chat session')
  .option('-m, --model <model>', 'Override default model')
  .option('-p, --profile <profile>', 'Use a specific profile')
  .option('--sandbox <mode>', 'Sandbox mode: read-only | workspace-write | full-access')
  .action(async (options: Record<string, string>) => {
    console.log(chalk.cyan.bold('\n  Xiaobai Agent v0.1.0'));
    console.log(chalk.gray('  Fusion of Hermes + OpenClaw + Claude Code + Codex\n'));

    try {
      const agent = await XiaobaiAgent.create();
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      let sessionId: string | undefined;

      const prompt = () => {
        rl.question(chalk.green('You: '), async (input) => {
          const trimmed = input.trim();
          if (!trimmed) {
            prompt();
            return;
          }

          if (trimmed === '/exit' || trimmed === '/quit') {
            console.log(chalk.gray('Goodbye!'));
            rl.close();
            process.exit(0);
          }

          if (trimmed === '/memory') {
            const usage = agent.getMemory().getUsage();
            console.log(chalk.yellow(`\nMemory: ${usage.memory.used}/${usage.memory.limit} chars`));
            console.log(chalk.yellow(`User:   ${usage.user.used}/${usage.user.limit} chars`));
            console.log(chalk.gray(`Entries: ${agent.getMemory().list('memory').length} memory, ${agent.getMemory().list('user').length} user\n`));
            prompt();
            return;
          }

          if (trimmed === '/tools') {
            const tools = agent.getTools().list();
            console.log(chalk.yellow(`\nAvailable tools (${tools.length}):`));
            tools.forEach((t) => console.log(chalk.gray(`  - ${t}`)));
            console.log();
            prompt();
            return;
          }

          if (trimmed === '/help') {
            console.log(chalk.yellow('\nCommands:'));
            console.log('  /exit, /quit  - Exit the session');
            console.log('  /memory       - Show memory usage');
            console.log('  /tools        - List available tools');
            console.log('  /help         - Show this help\n');
            prompt();
            return;
          }

          try {
            process.stdout.write(chalk.blue('Xiaobai: '));
            for await (const event of agent.chat(trimmed, sessionId)) {
              if (event.type === 'text') {
                process.stdout.write(event.content);
              } else if (event.type === 'tool_call') {
                process.stdout.write(chalk.gray(`\n  [${event.toolName}] `));
              } else if (event.type === 'tool_result') {
                process.stdout.write(chalk.gray(` -> ${event.result?.success ? 'OK' : 'FAIL'}`));
              } else if (event.type === 'stop') {
                process.stdout.write('\n');
              } else if (event.type === 'error') {
                process.stdout.write(chalk.red(`\nError: ${event.content}\n`));
              }
            }
          } catch (error) {
            console.log(chalk.red(`\nError: ${(error as Error).message}`));
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
  .action(async (prompt: string, _options: Record<string, string>) => {
    try {
      const agent = await XiaobaiAgent.create();
      const response = await agent.chatSync(prompt);
      console.log(response);
    } catch (error) {
      console.error(chalk.red('Error:'), (error as Error).message);
      process.exit(1);
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

    const server = new DashboardServer({
      port,
      staticDir: undefined,
    });

    await server.start();

    const httpUrl = server.getHttpUrl();
    const wsUrl = server.getUrl();

    console.log(chalk.cyan.bold('\n  Xiaobai Dashboard'));
    console.log(chalk.gray(`  HTTP:  ${httpUrl}`));
    console.log(chalk.gray(`  WS:    ${wsUrl}`));
    console.log(chalk.gray(`  Health: ${httpUrl}/health\n`));

    if (options.open) {
      const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${cmd} ${httpUrl}`);
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

    try {
      const agent = await XiaobaiAgent.create();

      if (options.port) {
        server = new DashboardServer({
          port: parseInt(options.port, 10),
        });
        await server.start();
        console.log(chalk.gray(`Dashboard: ${server.getHttpUrl()}`));
      }

      const orch = new Orchestrator({
        config: (agent as any).deps.config,
        provider: (agent as any).deps.provider,
        tools: (agent as any).deps.tools,
        sessions: (agent as any).deps.sessions,
        hooks: (agent as any).deps.hooks,
        memory: (agent as any).deps.memory,
        security: (agent as any).deps.security,
      });

      if (server) {
        server.attachOrchestrator(orch);
      }

      orch.addTask({
        description: prompt,
        role: options.role,
      });

      const events: string[] = [];
      orch.onEvent((event) => {
        switch (event.type) {
          case 'task_started':
            events.push(`[${event.agentId}] Started: ${event.task?.description?.slice(0, 60)}`);
            break;
          case 'task_completed':
            events.push(`[done] ${event.task?.description?.slice(0, 60)} (${event.result?.tokensUsed ?? 0} tokens)`);
            break;
          case 'task_failed':
            events.push(`[fail] ${event.error}`);
            break;
        }
      });

      console.log(chalk.cyan(`\nRunning: "${prompt}"`));
      console.log(chalk.gray(`Role: ${options.role}, Concurrency: ${options.concurrency}\n`));

      const results = await orch.execute({
        maxConcurrency: parseInt(options.concurrency, 10),
      });

      for (const e of events) {
        console.log(chalk.gray(`  ${e}`));
      }

      console.log(chalk.cyan('\n--- Results ---'));
      for (const result of results) {
        const icon = result.success ? chalk.green('✓') : chalk.red('✗');
        console.log(`${icon} ${result.taskId}: ${result.output.slice(0, 200)}`);
        if (result.error) {
          console.log(chalk.red(`  Error: ${result.error}`));
        }
      }

      console.log(chalk.gray(`\nTotal tokens: ${results.reduce((sum, r) => sum + r.tokensUsed, 0)}`));
    } catch (error) {
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

program.parse();
