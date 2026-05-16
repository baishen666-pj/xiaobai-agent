import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { highlightCode, getLanguageLabel } from './highlight.js';

export interface SpinnerOptions {
  frames?: string[];
  interval?: number;
}

const DEFAULT_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private frames: string[];
  private interval: number;
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastLine = '';

  constructor(options?: SpinnerOptions) {
    this.frames = options?.frames ?? DEFAULT_FRAMES;
    this.interval = options?.interval ?? 80;
  }

  start(text: string): void {
    this.stop();
    this.lastLine = text;
    process.stdout.write('\x1B[?25l'); // hide cursor
    this.timer = setInterval(() => {
      const frame = this.frames[this.frameIndex % this.frames.length];
      process.stdout.write(`\r${chalk.cyan(frame)} ${chalk.gray(this.lastLine)}`);
      this.frameIndex++;
    }, this.interval);
  }

  update(text: string): void {
    this.lastLine = text;
  }

  stop(clearLine = true): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.write('\x1B[?25h'); // show cursor
    if (clearLine) {
      process.stdout.write('\r\x1B[2K');
    }
  }

  succeed(text: string): void {
    this.stop();
    process.stdout.write(`\r${chalk.green('✔')} ${text}\n`);
  }

  fail(text: string): void {
    this.stop();
    process.stdout.write(`\r${chalk.red('✖')} ${text}\n`);
  }
}

export function renderMarkdown(text: string): string {
  let result = text;

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, (_, content) => chalk.bold(content));
  result = result.replace(/__(.+?)__/g, (_, content) => chalk.bold(content));

  // Italic: *text* or _text_
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_, content) => chalk.italic(content));

  // Inline code: `text`
  result = result.replace(/`([^`]+)`/g, (_, content) => chalk.cyan(content));

  // Headers
  result = result.replace(/^### (.+)$/gm, (_, content) => chalk.bold.cyan(`   ${content}`));
  result = result.replace(/^## (.+)$/gm, (_, content) => chalk.bold.cyan(`  ${content}`));
  result = result.replace(/^# (.+)$/gm, (_, content) => chalk.bold.cyan(content));

  // Tables: | head | head |\n| --- | --- |\n| cell | cell |
  result = result.replace(/^(\|.+\|)\n(\|[-:| ]+\|)\n((?:\|.+\|\n?)+)/gm, (_, headerRow, sepRow, bodyRows) => {
    return renderTable(headerRow, sepRow, bodyRows);
  });

  // Code blocks: ```lang\n...\n```
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const trimmed = code.trim();
    const width = getTerminalWidth();
    const border = chalk.gray('─'.repeat(Math.min(width, 80)));
    const label = getLanguageLabel(lang || undefined);
    const highlighted = highlightCode(trimmed, lang || undefined);
    return border + label + '\n' + highlighted + '\n' + border;
  });

  // Lists: - item
  result = result.replace(/^- (.+)$/gm, (_, content) => `  ${chalk.yellow('•')} ${content}`);

  // Numbered lists: 1. item
  result = result.replace(/^\d+\. (.+)$/gm, (match) => `  ${chalk.yellow(match.trim())}`);

  // Blockquotes: > text
  result = result.replace(/^> (.+)$/gm, (_, content) => `  ${chalk.gray('│')} ${chalk.gray(content)}`);

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => `${chalk.underline(text)} (${chalk.gray(url)})`);

  return result;
}

function renderTable(headerRow: string, sepRow: string, bodyRows: string): string {
  const parseCells = (row: string) =>
    row.split('|').map(c => c.trim()).filter(c => c.length > 0);

  const headers = parseCells(headerRow);
  const separators = parseCells(sepRow);
  const rows = bodyRows.trim().split('\n').map(r => parseCells(r));

  const alignments = separators.map(sep => {
    if (sep.startsWith(':') && sep.endsWith(':')) return 'center' as const;
    if (sep.endsWith(':')) return 'right' as const;
    return 'left' as const;
  });

  const colCount = headers.length;
  const colWidths = headers.map((h, i) => {
    const cellWidths = [h.length, ...rows.map(r => (r[i] ?? '').length)];
    return Math.min(Math.max(...cellWidths) + 2, Math.floor(getTerminalWidth() / colCount) - 3);
  });

  const pad = (text: string, width: number, align: 'left' | 'right' | 'center') => {
    const padLen = Math.max(0, width - text.length);
    if (align === 'right') return ' '.repeat(padLen) + text;
    if (align === 'center') return ' '.repeat(Math.floor(padLen / 2)) + text + ' '.repeat(Math.ceil(padLen / 2));
    return text + ' '.repeat(padLen);
  };

  const sep = chalk.gray('│');
  const lines: string[] = [];

  lines.push(chalk.gray('─'.repeat(colWidths.reduce((a, b) => a + b, 0) + colCount + 1)));

  const headerLine = headers.map((h, i) => chalk.bold(pad(h, colWidths[i], alignments[i]))).join(sep);
  lines.push(sep + headerLine + sep);

  lines.push(headers.map((_, i) => chalk.gray('─'.repeat(colWidths[i]))).join(chalk.gray('┼')) + '');

  for (const row of rows) {
    const rowLine = headers.map((_, i) => pad(row[i] ?? '', colWidths[i], alignments[i])).join(sep);
    lines.push(sep + rowLine + sep);
  }

  lines.push(chalk.gray('─'.repeat(colWidths.reduce((a, b) => a + b, 0) + colCount + 1)));

  return lines.join('\n');
}

export interface ToolDisplay {
  name: string;
  args: Record<string, unknown>;
  result?: { success: boolean; output: string };
}

export function formatToolCall(tool: ToolDisplay, compact = true): string {
  const name = chalk.yellow(tool.name);

  if (compact) {
    const summary = getToolArgSummary(tool.name, tool.args);
    const status = tool.result
      ? tool.result.success
        ? chalk.green(' ✓')
        : chalk.red(' ✗')
      : '';
    return `  ${name}(${chalk.gray(summary)})${status}`;
  }

  const args = Object.entries(tool.args)
    .map(([k, v]) => `${k}=${formatArgValue(v)}`)
    .join(', ');
  return `  ${name}(${chalk.gray(args)})`;
}

function getToolArgSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'bash':
      return truncate(String(args['command'] ?? ''), 60);
    case 'read':
      return truncate(String(args['file_path'] ?? ''), 60);
    case 'write': {
      const path = truncate(String(args['file_path'] ?? ''), 50);
      const content = String(args['content'] ?? '');
      const lines = content.split('\n').length;
      return `${path} (${lines} line${lines !== 1 ? 's' : ''} added)`;
    }
    case 'edit': {
      const path = truncate(String(args['file_path'] ?? ''), 50);
      const oldStr = String(args['old_string'] ?? '');
      const newStr = String(args['new_string'] ?? '');
      const oldLines = oldStr.split('\n').length;
      const newLines = newStr.split('\n').length;
      return `${path} (${oldLines} removed, ${newLines} added)`;
    }
    case 'grep':
      return truncate(String(args['pattern'] ?? ''), 40);
    case 'glob':
      return truncate(String(args['pattern'] ?? ''), 40);
    case 'memory':
      return `${args['action']} ${args['target']}`;
    default:
      return Object.keys(args).slice(0, 2).join(', ');
  }
}

function formatArgValue(v: unknown): string {
  if (typeof v === 'string') return `"${truncate(v, 40)}"`;
  return String(v);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

export function formatTokenUsage(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokenSummary(summary: { totalTokens: number; totalCost: number; totalPromptTokens: number; totalCompletionTokens: number; byModel: Map<string, { tokens: number; cost: number }> }): string {
  const lines: string[] = [];
  lines.push(chalk.cyan('  Session Cost Summary:'));
  lines.push(chalk.gray(`    Input:    ${formatTokenUsage(summary.totalPromptTokens)} tokens`));
  lines.push(chalk.gray(`    Output:   ${formatTokenUsage(summary.totalCompletionTokens)} tokens`));
  lines.push(chalk.gray(`    Total:    ${formatTokenUsage(summary.totalTokens)} tokens`));
  lines.push(chalk.gray(`    Cost:     ${formatCost(summary.totalCost)}`));

  if (summary.byModel.size > 0) {
    lines.push('');
    for (const [model, data] of summary.byModel) {
      lines.push(chalk.gray(`    ${model}: ${formatTokenUsage(data.tokens)} tokens, ${formatCost(data.cost)}`));
    }
  }

  return lines.join('\n');
}

export function clearLine(): void {
  process.stdout.write('\r\x1B[2K');
}

export function getTerminalWidth(): number {
  return process.stdout.columns ?? 80;
}

export function printBanner(): void {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  console.log(chalk.cyan.bold('\n  ╦ ╦┌┐┌┌─┐┬─┐┌┬┐'));
  console.log(chalk.cyan.bold('  ║║║││││  ├┬┘│││'));
  console.log(chalk.cyan.bold('  ╚╩╝┘└┘└─┘┴└─┴ ┴'));
  console.log(chalk.gray(`  v${pkg.version} — AI Agent Framework\n`));
}

export function printHelp(): void {
  console.log(chalk.yellow('\nCommands:'));
  console.log('  /exit, /quit             - Exit the session');
  console.log('  /clear                   - Clear conversation history');
  console.log('  /compact                 - Force context compaction');
  console.log('  /memory                  - Show memory usage');
  console.log('  /tools                   - List available tools');
  console.log('  /sessions                - List saved sessions');
  console.log('  /model                   - Show current provider/model');
  console.log('  /model <provider>        - Switch provider');
  console.log('  /model <p> <model>       - Switch provider and model');
  console.log('  /export [format]         - Export session (json or markdown)');
  console.log('  /metrics                 - Show runtime metrics');
  console.log('  /health                  - Show provider health status');
  console.log('  /help                    - Show this help\n');
}
