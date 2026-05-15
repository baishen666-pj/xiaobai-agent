import chalk from 'chalk';

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

  // Code blocks: ```lang\n...\n```
  result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const trimmed = code.trim();
    return chalk.gray('─'.repeat(40)) + '\n' + chalk.green(trimmed) + '\n' + chalk.gray('─'.repeat(40));
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
    case 'write':
    case 'edit':
      return truncate(String(args['file_path'] ?? ''), 60);
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

export function clearLine(): void {
  process.stdout.write('\r\x1B[2K');
}

export function printBanner(): void {
  console.log(chalk.cyan.bold('\n  ╦ ╦┌┐┌┌─┐┬─┐┌┬┐'));
  console.log(chalk.cyan.bold('  ║║║││││  ├┬┘│││'));
  console.log(chalk.cyan.bold('  ╚╩╝┘└┘└─┘┴└─┴ ┴'));
  console.log(chalk.gray('  v0.1.0 — AI Agent Framework\n'));
}

export function printHelp(): void {
  console.log(chalk.yellow('\nCommands:'));
  console.log('  /exit, /quit   - Exit the session');
  console.log('  /clear         - Clear conversation history');
  console.log('  /compact       - Force context compaction');
  console.log('  /memory        - Show memory usage');
  console.log('  /tools         - List available tools');
  console.log('  /sessions      - List saved sessions');
  console.log('  /model [name]  - Show or switch model');
  console.log('  /help          - Show this help\n');
}
