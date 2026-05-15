import chalk from 'chalk';
import { highlightCode, getLanguageLabel } from './highlight.js';
import { getTerminalWidth } from './renderer.js';

export class StreamingMarkdownRenderer {
  private buffer = '';
  private inCodeBlock = false;
  private codeBlockLang = '';
  private codeBlockLines: string[] = [];
  private codeFenceBuffer = '';

  push(chunk: string): void {
    this.buffer += chunk;

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      this.processLine(line);
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.processLine(this.buffer);
      this.buffer = '';
    }
    if (this.inCodeBlock) {
      this.flushCodeBlock();
    }
  }

  reset(): void {
    this.buffer = '';
    this.inCodeBlock = false;
    this.codeBlockLang = '';
    this.codeBlockLines = [];
    this.codeFenceBuffer = '';
  }

  private processLine(line: string): void {
    const trimmed = line.trimEnd();

    // Code fence detection
    if (trimmed.startsWith('```')) {
      if (this.inCodeBlock) {
        // Check if this is actually the opening fence arriving late
        this.codeFenceBuffer += '\n' + line;
        if (this.codeBlockLines.length === 0 && trimmed === '```') {
          // Empty code block, close it
          this.flushCodeBlock();
          return;
        }
        this.flushCodeBlock();
      } else {
        this.inCodeBlock = true;
        this.codeBlockLang = trimmed.slice(3).trim();
        this.codeBlockLines = [];
        const width = getTerminalWidth();
        const border = chalk.gray('─'.repeat(Math.min(width, 80)));
        const label = getLanguageLabel(this.codeBlockLang || undefined);
        process.stdout.write(border + label + '\n');
      }
      return;
    }

    if (this.inCodeBlock) {
      this.codeBlockLines.push(line);
      return;
    }

    // Render markdown line immediately
    process.stdout.write(this.renderLine(trimmed) + '\n');
  }

  private flushCodeBlock(): void {
    const code = this.codeBlockLines.join('\n');
    const highlighted = highlightCode(code, this.codeBlockLang || undefined);
    process.stdout.write(highlighted + '\n');

    const width = getTerminalWidth();
    const border = chalk.gray('─'.repeat(Math.min(width, 80)));
    process.stdout.write(border + '\n');

    this.inCodeBlock = false;
    this.codeBlockLang = '';
    this.codeBlockLines = [];
  }

  private renderLine(line: string): string {
    if (!line) return '';

    // Headers
    if (line.startsWith('### ')) return chalk.bold.cyan(`   ${line.slice(4)}`);
    if (line.startsWith('## ')) return chalk.bold.cyan(`  ${line.slice(3)}`);
    if (line.startsWith('# ')) return chalk.bold.cyan(line.slice(2));

    // Lists
    if (line.startsWith('- ')) return `  ${chalk.yellow('•')} ${this.renderInline(line.slice(2))}`;

    // Numbered lists
    const listMatch = line.match(/^(\d+\.) (.+)$/);
    if (listMatch) return `  ${chalk.yellow(listMatch[1])} ${this.renderInline(listMatch[2])}`;

    // Blockquotes
    if (line.startsWith('> ')) return `  ${chalk.gray('│')} ${chalk.gray(line.slice(2))}`;

    // Table rows (pass through for alignment)
    if (line.startsWith('|') && line.endsWith('|')) return this.renderInline(line);

    return this.renderInline(line);
  }

  private renderInline(text: string): string {
    let result = text;

    // Bold
    result = result.replace(/\*\*(.+?)\*\*/g, (_, c) => chalk.bold(c));
    // Italic
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_, c) => chalk.italic(c));
    // Inline code
    result = result.replace(/`([^`]+)`/g, (_, c) => chalk.cyan(c));
    // Links
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `${chalk.underline(t)} (${chalk.gray(u)})`);

    return result;
  }
}
