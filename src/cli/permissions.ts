import chalk from 'chalk';
import { createInterface, type Interface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SecurityManager } from '../security/manager.js';

export type PermissionDecision = 'allow' | 'deny' | 'always';

export interface PermissionRule {
  tool: string;
  pattern?: string;
  decision: PermissionDecision;
}

const AUTO_ALLOW_TOOLS = new Set(['read', 'grep', 'glob']);
const DANGEROUS_COMMANDS = ['rm -rf', 'format', 'del /s', 'dd if=', 'mkfs', ':(){:|:&};:'];

const SENSITIVE_PATH_PATTERNS = [
  /\/etc\/(passwd|shadow|ssh|gpg|ssl)/i,
  /\\windows\\system32\\config/i,
  /\.ssh\//i,
  /\.gnupg\//i,
  /\.env$/i,
];

function isSensitivePath(filePath: string): boolean {
  const resolved = resolve(filePath);
  return SENSITIVE_PATH_PATTERNS.some((p) => p.test(resolved));
}

export function generateDiff(oldContent: string, newContent: string, maxLines: number = 20): string {
  const oldLines = oldContent === '' ? [] : oldContent.split('\n');
  const newLines = newContent === '' ? [] : newContent.split('\n');

  const output: string[] = [];
  let changesShown = 0;

  // Simple line-by-line diff: find matching prefix and suffix, mark middle as changed
  const prefixLen = commonPrefixLength(oldLines, newLines);
  const suffixLen = commonSuffixLength(oldLines.slice(prefixLen), newLines.slice(prefixLen));

  const oldChanged = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const newChanged = newLines.slice(prefixLen, newLines.length - suffixLen);

  // Show removed lines
  for (const line of oldChanged) {
    if (changesShown >= maxLines) break;
    output.push(chalk.red(`- ${line}`));
    changesShown++;
  }

  // Show added lines
  for (const line of newChanged) {
    if (changesShown >= maxLines) break;
    output.push(chalk.green(`+ ${line}`));
    changesShown++;
  }

  if (changesShown >= maxLines) {
    const totalChanges = oldChanged.length + newChanged.length;
    const remaining = totalChanges - maxLines;
    if (remaining > 0) {
      output.push(chalk.gray(`... ${remaining} more changes not shown`));
    }
  }

  // Summary line
  const added = newChanged.length;
  const removed = oldChanged.length;
  output.push(chalk.gray(`${added} line${added !== 1 ? 's' : ''} added, ${removed} line${removed !== 1 ? 's' : ''} removed`));

  return output.join('\n');
}

function commonPrefixLength(a: string[], b: string[]): number {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    if (a[i] !== b[i]) return i;
  }
  return min;
}

function commonSuffixLength(a: string[], b: string[]): number {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    if (a[a.length - 1 - i] !== b[b.length - 1 - i]) return i;
  }
  return min;
}

export function generateDiffPreview(tool: string, args: Record<string, unknown>, maxLines: number = 20): string {
  const filePath = String(args['file_path'] ?? '');

  if (tool === 'write') {
    const newContent = String(args['content'] ?? '');

    if (existsSync(filePath) && !isSensitivePath(filePath)) {
      try {
        const oldContent = readFileSync(filePath, 'utf-8');
        const header = chalk.cyan(`  Diff for ${filePath} (existing file):`);
        return header + '\n' + generateDiff(oldContent, newContent, maxLines);
      } catch (e) {
        console.debug('permissions: cannot read existing file for diff', (e as Error).message);
        const header = chalk.cyan(`  Diff for ${filePath} (cannot read existing file):`);
        const preview = newContent.split('\n').slice(0, maxLines);
        const truncated = newContent.split('\n').length > maxLines;
        const lines = preview.map((l) => chalk.green(`+ ${l}`));
        if (truncated) {
          const remaining = newContent.split('\n').length - maxLines;
          lines.push(chalk.gray(`... ${remaining} more lines not shown`));
        }
        lines.push(chalk.gray(`${newContent.split('\n').length} lines total (new file)`));
        return header + '\n' + lines.join('\n');
      }
    } else {
      const header = chalk.cyan(`  Diff for ${filePath} (new file):`);
      const allLines = newContent.split('\n');
      const preview = allLines.slice(0, maxLines);
      const truncated = allLines.length > maxLines;
      const lines = preview.map((l) => chalk.green(`+ ${l}`));
      if (truncated) {
        const remaining = allLines.length - maxLines;
        lines.push(chalk.gray(`... ${remaining} more lines not shown`));
      }
      lines.push(chalk.gray(`${allLines.length} lines total (new file)`));
      return header + '\n' + lines.join('\n');
    }
  }

  if (tool === 'edit') {
    const oldString = String(args['old_string'] ?? '');
    const newString = String(args['new_string'] ?? '');
    const header = chalk.cyan(`  Diff for ${filePath} (edit):`);
    return header + '\n' + generateDiff(oldString, newString, maxLines);
  }

  return '';
}

export class PermissionPrompt {
  private rules: PermissionRule[] = [];
  private mode: 'default' | 'auto' | 'plan' | 'accept-edits';
  private rl: Interface | null = null;
  private trustedToolTypes = new Set<string>();
  private securityManager?: SecurityManager;

  constructor(mode: 'default' | 'auto' | 'plan' | 'accept-edits' = 'default', securityManager?: SecurityManager) {
    this.mode = mode;
    this.securityManager = securityManager;
  }

  setReadline(rl: Interface): void {
    this.rl = rl;
  }

  addTrustedToolType(toolName: string): void {
    this.trustedToolTypes.add(toolName);
    this.securityManager?.addTrustedToolType(toolName);
  }

  isToolTypeTrusted(toolName: string): boolean {
    return this.trustedToolTypes.has(toolName);
  }

  getTrustedToolTypes(): ReadonlySet<string> {
    return this.trustedToolTypes;
  }

  async checkPermission(tool: string, args: Record<string, unknown>): Promise<boolean> {
    if (this.mode === 'auto') return true;
    if (this.mode === 'plan' && !AUTO_ALLOW_TOOLS.has(tool)) return false;
    if (this.mode === 'accept-edits' && (AUTO_ALLOW_TOOLS.has(tool) || tool === 'edit' || tool === 'write')) return true;

    const cached = this.checkRules(tool, args);
    if (cached !== null) return cached;

    if (AUTO_ALLOW_TOOLS.has(tool)) return true;

    if (this.trustedToolTypes.has(tool)) return true;

    if (tool === 'bash') {
        const cmd = String(args['command'] ?? '');
        const dangerous = this.securityManager
          ? this.securityManager.isDangerousCommand(cmd)
          : isDangerous(cmd);
        if (!dangerous) return true;
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
    const hasDiff = tool === 'write' || tool === 'edit';

    console.log('\n' + chalk.yellow('Permission required:'));
    console.log(`  ${chalk.bold(tool)} ${chalk.gray(summary)}`);
    console.log(chalk.gray(`  [y] Allow  [n] Deny  [a] Always allow for this session  [t] Trust tool type${hasDiff ? '  [d] Show diff' : ''}`));

    while (true) {
      const answer = await this.readLine(chalk.white('  > '));
      const normalized = answer.toLowerCase().trim();

      if (normalized === 'a' || normalized === 'always') {
        this.rules.push({ tool, decision: 'always' });
        console.log(chalk.green(`  ${tool} allowed for this session`));
        return true;
      }

      if (normalized === 't' || normalized === 'trust') {
        this.trustedToolTypes.add(tool);
        this.securityManager?.addTrustedToolType(tool);
        console.log(chalk.green(`  ${tool} is now trusted for this session`));
        return true;
      }

      if ((normalized === 'd' || normalized === 'diff') && hasDiff) {
        const diffOutput = generateDiffPreview(tool, args);
        if (diffOutput) {
          console.log(diffOutput);
        }
        continue;
      }

      if (normalized === 'y' || normalized === 'yes') {
        return true;
      }

      console.log(chalk.red(`  ${tool} denied`));
      return false;
    }
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
