#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { registerChatCommand } from './repl.js';
import {
  registerExecCommand,
  registerMemoryCommand,
  registerConfigCommand,
  registerDashboardCommand,
  registerRunCommand,
  registerAgentsCommand,
  registerSkillsCommand,
  registerPluginsCommand,
} from './commands.js';

const program = new Command();

program
  .name('xiaobai')
  .description('Xiaobai - A fusion AI agent combining the best of Hermes, OpenClaw, Claude Code, and Codex')
  .version('0.3.0');

registerChatCommand(program);
registerExecCommand(program);
registerMemoryCommand(program);
registerConfigCommand(program);
registerDashboardCommand(program);
registerRunCommand(program);
registerAgentsCommand(program);
registerSkillsCommand(program);
registerPluginsCommand(program);

export { program };

if (!process.env.VITEST) program.parse();
