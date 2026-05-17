import chalk from 'chalk';
import { Command } from 'commander';
import { XiaobaiAgent } from '../core/agent.js';
import { PricingTable } from '../core/pricing.js';
import { TokenTracker } from '../core/token-tracker.js';
import { exportToJson, exportToMarkdown } from '../core/export.js';
import { ProviderHealthChecker } from '../provider/health.js';
import { DashboardServer } from '../server/index.js';
import type { LoopEvent } from '../core/loop.js';
import { createInterface } from 'node:readline';
import { Spinner, renderMarkdown, formatToolCall, formatTokenUsage, printBanner, printHelp, formatCost, formatTokenSummary } from './renderer.js';
import { StreamingMarkdownRenderer } from './streaming-renderer.js';
import { PermissionPrompt } from './permissions.js';

export function registerChatCommand(program: Command): Command {
  program
    .command('chat')
    .description('Start an interactive chat session')
    .option('-m, --model <model>', 'Override default model')
    .option('-p, --profile <profile>', 'Use a specific profile')
    .option('--sandbox <mode>', 'Sandbox mode: read-only | workspace-write | full-access')
    .option('--auto', 'Auto-approve all tool calls')
    .option('--dashboard [port]', 'Enable dashboard with optional port')
    .option('-r, --resume [sessionId]', 'Resume a previous session (latest if no ID given)')
    .option('--tui', 'Use Ink TUI multi-panel interface')
    .action(async (opts: Record<string, unknown>) => {
      const options = opts as Record<string, string>;
      try {
        const agent = await XiaobaiAgent.create();

        if (opts.tui === true) {
          const { startTui } = await import('./tui/index.js');
          await startTui(agent, { model: options.model, auto: opts.auto === true });
          return;
        }

        printBanner();
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
        let chatListener: ((event: LoopEvent) => void) | undefined;

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
                sessions.slice(0, 10).forEach((s) => {
                  const sessionData = s as unknown as { updatedAt?: string | number; messageCount?: number; id: string };
                  const age = sessionData.updatedAt ? new Date(sessionData.updatedAt).toLocaleString() : 'unknown';
                  console.log(chalk.gray(`    ${sessionData.id} (${sessionData.messageCount ?? '?'} msgs, ${age})`));
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

  return program;
}