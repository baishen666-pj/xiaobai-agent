#!/usr/bin/env node
import { Command } from 'commander';
import { XiaobaiAgent } from '../core/agent.js';
import chalk from 'chalk';
import { createInterface } from 'node:readline';

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
  .action(async (options) => {
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
  .action(async (prompt, options) => {
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

program.parse();
