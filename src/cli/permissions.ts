import chalk from 'chalk';
import { createInterface, type Interface } from 'node:readline';

export type PermissionDecision = 'allow' | 'deny' | 'always';

export interface PermissionRule {
  tool: string;
  pattern?: string;
  decision: PermissionDecision;
}

const AUTO_ALLOW_TOOLS = new Set(['read', 'grep', 'glob']);
const DANGEROUS_COMMANDS = ['rm -rf', 'format', 'del /s', 'dd if=', 'mkfs', ':(){:|:&};:'];

export class PermissionPrompt {
  private rules: PermissionRule[] = [];
  private mode: 'default' | 'auto' | 'plan' | 'accept-edits';
  private rl: Interface | null = null;

  constructor(mode: 'default' | 'auto' | 'plan' | 'accept-edits' = 'default') {
    this.mode = mode;
  }

  setReadline(rl: Interface): void {
    this.rl = rl;
  }

  async checkPermission(tool: string, args: Record<string, unknown>): Promise<boolean> {
    if (this.mode === 'auto') return true;
    if (this.mode === 'plan' && !AUTO_ALLOW_TOOLS.has(tool)) return false;
    if (this.mode === 'accept-edits' && (AUTO_ALLOW_TOOLS.has(tool) || tool === 'edit' || tool === 'write')) return true;

    const cached = this.checkRules(tool, args);
    if (cached !== null) return cached;

    if (AUTO_ALLOW_TOOLS.has(tool)) return true;

    if (tool === 'bash' && !isDangerous(args['command'] as string)) {
      return true;
    }

    return this.promptUser(tool, args);
  }

  private checkRules(tool: string, args: Record<string, unknown>): boolean | null {
    for (const rule of this.rules) {
      if (rule.tool !== tool) continue;
      if (rule.pattern) {
        const argStr = JSON.stringify(args);
        if (!argStr.includes(rule.pattern)) continue;
      }
      return rule.decision !== 'deny';
    }
    return null;
  }

  private async promptUser(tool: string, args: Record<string, unknown>): Promise<boolean> {
    const summary = formatToolSummary(tool, args);
    console.log('\n' + chalk.yellow('⚡ Permission required:'));
    console.log(`  ${chalk.bold(tool)} ${chalk.gray(summary)}`);
    console.log(chalk.gray(`  [y] Allow  [n] Deny  [a] Always allow for this session`));

    const answer = await this.readLine(chalk.white('  → '));
    const normalized = answer.toLowerCase().trim();

    if (normalized === 'a' || normalized === 'always') {
      this.rules.push({ tool, decision: 'always' });
      console.log(chalk.green(`  ✔ ${tool} allowed for this session\n`));
      return true;
    }

    if (normalized === 'y' || normalized === 'yes') {
      return true;
    }

    console.log(chalk.red(`  ✖ ${tool} denied\n`));
    return false;
  }

  private readLine(prompt: string): Promise<string> {
    if (this.rl) {
      return new Promise((resolve) => {
        this.rl!.question(prompt, (answer) => resolve(answer));
      });
    }
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

function isDangerous(command?: string): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  return DANGEROUS_COMMANDS.some((d) => lower.includes(d));
}

function formatToolSummary(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'bash': {
      const cmd = String(args['command'] ?? '');
      const cwd = args['cwd'] ? ` (cwd: ${args['cwd']})` : '';
      return truncate(cmd, 80) + cwd;
    }
    case 'write':
    case 'edit':
      return String(args['file_path'] ?? '');
    case 'memory':
      return `${args['action']} ${args['target']}`;
    default:
      return Object.keys(args).join(', ');
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}
