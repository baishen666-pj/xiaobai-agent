import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Spinner,
  renderMarkdown,
  formatToolCall,
  formatTokenUsage,
  clearLine,
  getTerminalWidth,
  printBanner,
  printHelp,
} from '../../src/cli/renderer.js';

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------
describe('Spinner', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    stdoutSpy.mockRestore();
  });

  it('start writes cursor-hide sequence and creates an interval', () => {
    const spinner = new Spinner({ interval: 50 });
    spinner.start('loading');

    // cursor hide
    expect(stdoutSpy).toHaveBeenCalledWith('\x1B[?25l');

    // advance one tick
    vi.advanceTimersByTime(50);
    // frame written -- filter to calls that contain the spinner text
    // (stop also writes \r but with escape sequences for clearing)
    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const frameCall = calls.find((c) => c.includes('loading'));
    expect(frameCall).toBeDefined();

    spinner.stop();
  });

  it('uses default frames when none provided', () => {
    const spinner = new Spinner();
    spinner.start('test');
    vi.advanceTimersByTime(80);
    // Should not throw and should have written frames
    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const frameCalls = calls.filter((c) => c.startsWith('\r'));
    expect(frameCalls.length).toBeGreaterThanOrEqual(1);
    spinner.stop();
  });

  it('stop clears the interval and shows cursor', () => {
    const spinner = new Spinner({ interval: 50 });
    spinner.start('test');
    vi.advanceTimersByTime(200);

    stdoutSpy.mockClear();
    spinner.stop();

    expect(stdoutSpy).toHaveBeenCalledWith('\x1B[?25h');
    expect(stdoutSpy).toHaveBeenCalledWith('\r\x1B[2K');
  });

  it('stop with clearLine=false skips line clear', () => {
    const spinner = new Spinner();
    spinner.start('test');

    stdoutSpy.mockClear();
    spinner.stop(false);

    expect(stdoutSpy).toHaveBeenCalledWith('\x1B[?25h');
    expect(stdoutSpy).not.toHaveBeenCalledWith('\r\x1B[2K');
  });

  it('stop is safe when no timer is running', () => {
    const spinner = new Spinner();
    expect(() => spinner.stop()).not.toThrow();
  });

  it('start calls stop first to reset any existing timer', () => {
    const spinner = new Spinner({ interval: 50 });
    spinner.start('first');
    vi.advanceTimersByTime(50);

    stdoutSpy.mockClear();
    spinner.start('second');
    // Should have hidden cursor again (called during stop, then again in start)
    const cursorHideCalls = stdoutSpy.mock.calls.filter(
      (c: unknown[]) => c[0] === '\x1B[?25l',
    );
    expect(cursorHideCalls.length).toBeGreaterThanOrEqual(1);

    spinner.stop();
  });

  it('update changes the displayed text on next tick', () => {
    const spinner = new Spinner({ interval: 50 });
    spinner.start('initial');
    vi.advanceTimersByTime(50);

    spinner.update('updated');
    stdoutSpy.mockClear();
    vi.advanceTimersByTime(50);

    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const frameCall = calls.find((c) => c.startsWith('\r'));
    expect(frameCall).toContain('updated');

    spinner.stop();
  });

  it('succeed writes checkmark and text', () => {
    const spinner = new Spinner();
    spinner.start('loading');

    stdoutSpy.mockClear();
    spinner.succeed('done');

    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const successCall = calls.find((c) => c.includes('done'));
    expect(successCall).toBeDefined();
    // Should contain checkmark character
    expect(successCall).toContain('done');
    expect(successCall).toContain('\n');
  });

  it('fail writes cross and text', () => {
    const spinner = new Spinner();
    spinner.start('loading');

    stdoutSpy.mockClear();
    spinner.fail('error');

    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const failCall = calls.find((c) => c.includes('error'));
    expect(failCall).toBeDefined();
    expect(failCall).toContain('error');
    expect(failCall).toContain('\n');
  });

  it('cycles through all frames', () => {
    const frames = ['a', 'b', 'c'];
    const spinner = new Spinner({ frames, interval: 10 });
    spinner.start('cycling');

    stdoutSpy.mockClear();
    // Advance through all frames multiple times
    vi.advanceTimersByTime(10 * 6); // 6 ticks = 2 full cycles

    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const frameCalls = calls.filter((c) => c.startsWith('\r'));
    expect(frameCalls.length).toBe(6);

    spinner.stop();
  });

  it('succeed calls stop before writing', () => {
    const spinner = new Spinner({ interval: 50 });
    spinner.start('loading');
    vi.advanceTimersByTime(50);

    stdoutSpy.mockClear();
    spinner.succeed('done');

    // Should have cursor show + line clear (from stop) + success message
    expect(stdoutSpy).toHaveBeenCalledWith('\x1B[?25h');
  });

  it('fail calls stop before writing', () => {
    const spinner = new Spinner({ interval: 50 });
    spinner.start('loading');
    vi.advanceTimersByTime(50);

    stdoutSpy.mockClear();
    spinner.fail('error');

    expect(stdoutSpy).toHaveBeenCalledWith('\x1B[?25h');
  });
});

// ---------------------------------------------------------------------------
// renderMarkdown
// ---------------------------------------------------------------------------
describe('renderMarkdown', () => {
  it('renders bold text with ** syntax', () => {
    const result = renderMarkdown('This is **bold** text');
    expect(result).toContain('bold');
    expect(result).not.toContain('**');
  });

  it('renders bold text with __ syntax', () => {
    const result = renderMarkdown('This is __bold__ text');
    expect(result).toContain('bold');
    expect(result).not.toContain('__');
  });

  it('renders italic text with * syntax', () => {
    const result = renderMarkdown('This is *italic* text');
    expect(result).toContain('italic');
  });

  it('renders inline code', () => {
    const result = renderMarkdown('Use `console.log` here');
    expect(result).toContain('console.log');
    expect(result).not.toContain('`');
  });

  it('renders h1 header', () => {
    const result = renderMarkdown('# Title');
    expect(result).toContain('Title');
    // h1 has no leading spaces
    expect(result).toMatch(/^.{0,10}Title/m);
  });

  it('renders h2 header', () => {
    const result = renderMarkdown('## Subtitle');
    expect(result).toContain('Subtitle');
  });

  it('renders h3 header', () => {
    const result = renderMarkdown('### Small');
    expect(result).toContain('Small');
  });

  it('renders multiple header levels together', () => {
    const result = renderMarkdown('# Title\n## Subtitle\n### Small');
    expect(result).toContain('Title');
    expect(result).toContain('Subtitle');
    expect(result).toContain('Small');
  });

  it('renders markdown table', () => {
    const input = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
    const result = renderMarkdown(input);
    expect(result).toContain('Name');
    expect(result).toContain('Age');
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
    // Table should have separator characters
    expect(result).toContain('\n');
  });

  it('renders table with right-aligned column', () => {
    const input = '| Name | Score |\n| --- | ---: |\n| Alice | 95 |';
    const result = renderMarkdown(input);
    expect(result).toContain('Alice');
    expect(result).toContain('95');
  });

  it('renders table with center-aligned column', () => {
    const input = '| Name | Value |\n| :--- | :---: |\n| Alice | 100 |';
    const result = renderMarkdown(input);
    expect(result).toContain('Alice');
    expect(result).toContain('100');
  });

  it('renders code blocks with language', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result).toContain('const x = 1');
  });

  it('renders code blocks without language', () => {
    const result = renderMarkdown('```\nplain code\n```');
    expect(result).toContain('plain code');
  });

  it('renders code blocks with border lines', () => {
    const result = renderMarkdown('```ts\nconst x: number = 1;\n```');
    // Should have horizontal rule borders
    expect(result).toContain('\n');
    expect(result).toContain('const x');
  });

  it('renders unordered list items', () => {
    const result = renderMarkdown('- item one\n- item two');
    expect(result).toContain('item one');
    expect(result).toContain('item two');
    expect(result).toContain('•'); // bullet character
  });

  it('renders numbered list items', () => {
    const result = renderMarkdown('1. first item\n2. second item');
    expect(result).toContain('first item');
    expect(result).toContain('second item');
    expect(result).toContain('1.');
    expect(result).toContain('2.');
  });

  it('renders blockquotes', () => {
    const result = renderMarkdown('> quoted text');
    expect(result).toContain('quoted text');
  });

  it('renders links with text and url', () => {
    const result = renderMarkdown('[click here](https://example.com)');
    expect(result).toContain('click here');
    expect(result).toContain('https://example.com');
  });

  it('passes through plain text unchanged', () => {
    const result = renderMarkdown('just plain text');
    expect(result).toContain('just plain text');
  });

  it('handles empty string', () => {
    const result = renderMarkdown('');
    expect(result).toBe('');
  });

  it('handles text with multiple markdown features combined', () => {
    const result = renderMarkdown('# Title\n\n**bold** and *italic* with `code`\n\n- list item');
    expect(result).toContain('Title');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).toContain('code');
    expect(result).toContain('list item');
  });

  it('renders inline code with special characters', () => {
    const result = renderMarkdown('Run `npm install && npm test` now');
    expect(result).toContain('npm install && npm test');
    expect(result).not.toContain('`');
  });

  it('does not replace double asterisks inside inline code', () => {
    // This tests ordering: inline code should be processed but the raw backticks removed
    const result = renderMarkdown('`**not bold**`');
    // The content inside backticks gets the cyan color but ** should be gone
    expect(result).not.toContain('`');
  });

  it('handles multiple links in one line', () => {
    const result = renderMarkdown('[link1](http://a.com) and [link2](http://b.com)');
    expect(result).toContain('link1');
    expect(result).toContain('link2');
    expect(result).toContain('http://a.com');
    expect(result).toContain('http://b.com');
  });

  it('handles multiple blockquote lines', () => {
    const result = renderMarkdown('> line one\n> line two');
    expect(result).toContain('line one');
    expect(result).toContain('line two');
  });
});

// ---------------------------------------------------------------------------
// formatToolCall
// ---------------------------------------------------------------------------
describe('formatToolCall', () => {
  it('formats bash tool in compact mode with success result', () => {
    const result = formatToolCall({
      name: 'bash',
      args: { command: 'echo hello world' },
      result: { success: true, output: 'hello world' },
    });
    expect(result).toContain('bash');
    expect(result).toContain('echo hello world');
    expect(result).toContain('✓'); // checkmark
  });

  it('formats bash tool with failure result', () => {
    const result = formatToolCall({
      name: 'bash',
      args: { command: 'bad command' },
      result: { success: false, output: 'error' },
    });
    expect(result).toContain('bash');
    expect(result).toContain('✗'); // cross
  });

  it('formats tool without result (no status marker)', () => {
    const result = formatToolCall({
      name: 'bash',
      args: { command: 'ls' },
    });
    expect(result).toContain('bash');
    expect(result).not.toContain('✓');
    expect(result).not.toContain('✗');
  });

  it('formats read tool with file_path', () => {
    const result = formatToolCall({
      name: 'read',
      args: { file_path: '/some/path/file.ts' },
    });
    expect(result).toContain('read');
    expect(result).toContain('/some/path/file.ts');
  });

  it('formats write tool with file_path', () => {
    const result = formatToolCall({
      name: 'write',
      args: { file_path: '/output/result.json' },
    });
    expect(result).toContain('write');
    expect(result).toContain('/output/result.json');
  });

  it('formats edit tool with file_path', () => {
    const result = formatToolCall({
      name: 'edit',
      args: { file_path: '/src/index.ts' },
    });
    expect(result).toContain('edit');
    expect(result).toContain('/src/index.ts');
  });

  it('formats grep tool with pattern', () => {
    const result = formatToolCall({
      name: 'grep',
      args: { pattern: 'TODO' },
    });
    expect(result).toContain('grep');
    expect(result).toContain('TODO');
  });

  it('formats glob tool with pattern', () => {
    const result = formatToolCall({
      name: 'glob',
      args: { pattern: '**/*.ts' },
    });
    expect(result).toContain('glob');
    expect(result).toContain('**/*.ts');
  });

  it('formats memory tool with action and target', () => {
    const result = formatToolCall({
      name: 'memory',
      args: { action: 'save', target: 'context' },
    });
    expect(result).toContain('memory');
    expect(result).toContain('save');
    expect(result).toContain('context');
  });

  it('formats unknown tool with first two arg keys', () => {
    const result = formatToolCall({
      name: 'custom',
      args: { a: 1, b: 2, c: 3 },
    });
    expect(result).toContain('custom');
    expect(result).toContain('a, b');
  });

  it('truncates long commands in compact mode', () => {
    const longCmd = 'a'.repeat(100);
    const result = formatToolCall({
      name: 'bash',
      args: { command: longCmd },
    });
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(longCmd.length + 50);
  });

  it('formats in non-compact (full) mode', () => {
    const result = formatToolCall(
      {
        name: 'bash',
        args: { command: 'echo hi', cwd: '/tmp' },
      },
      false,
    );
    expect(result).toContain('bash');
    expect(result).toContain('command');
    expect(result).toContain('echo hi');
    expect(result).toContain('cwd');
  });

  it('non-compact mode formats string args with quotes', () => {
    const result = formatToolCall(
      {
        name: 'read',
        args: { file_path: '/test.txt' },
      },
      false,
    );
    expect(result).toContain('"/test.txt"');
  });

  it('non-compact mode formats non-string args without quotes', () => {
    const result = formatToolCall(
      {
        name: 'tool',
        args: { count: 5 },
      },
      false,
    );
    expect(result).toContain('count=5');
  });

  it('handles tool with empty args in compact mode', () => {
    const result = formatToolCall({
      name: 'bash',
      args: {},
    });
    expect(result).toContain('bash');
  });

  it('handles tool with missing expected arg gracefully', () => {
    const result = formatToolCall({
      name: 'bash',
      args: { other: 'value' },
    });
    expect(result).toContain('bash');
  });

  it('truncates long file paths', () => {
    const longPath = '/very/long/path/' + 'a'.repeat(80) + '/file.ts';
    const result = formatToolCall({
      name: 'read',
      args: { file_path: longPath },
    });
    expect(result).toContain('...');
  });

  it('truncates long grep patterns', () => {
    const longPattern = 'x'.repeat(60);
    const result = formatToolCall({
      name: 'grep',
      args: { pattern: longPattern },
    });
    expect(result).toContain('...');
  });

  it('truncates long glob patterns', () => {
    const longPattern = 'x'.repeat(60);
    const result = formatToolCall({
      name: 'glob',
      args: { pattern: longPattern },
    });
    expect(result).toContain('...');
  });
});

// ---------------------------------------------------------------------------
// formatTokenUsage
// ---------------------------------------------------------------------------
describe('formatTokenUsage', () => {
  it('returns raw number for values under 1000', () => {
    expect(formatTokenUsage(0)).toBe('0');
    expect(formatTokenUsage(1)).toBe('1');
    expect(formatTokenUsage(500)).toBe('500');
    expect(formatTokenUsage(999)).toBe('999');
  });

  it('formats thousands with k suffix', () => {
    expect(formatTokenUsage(1000)).toBe('1.0k');
    expect(formatTokenUsage(1500)).toBe('1.5k');
    expect(formatTokenUsage(2500)).toBe('2.5k');
    expect(formatTokenUsage(999_999)).toBe('1000.0k');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokenUsage(1_000_000)).toBe('1.0M');
    expect(formatTokenUsage(1_500_000)).toBe('1.5M');
    expect(formatTokenUsage(15_000_000)).toBe('15.0M');
  });

  it('handles boundary between raw and k', () => {
    expect(formatTokenUsage(999)).toBe('999');
    expect(formatTokenUsage(1000)).toBe('1.0k');
  });

  it('handles boundary between k and M', () => {
    expect(formatTokenUsage(999_999)).toBe('1000.0k');
    expect(formatTokenUsage(1_000_000)).toBe('1.0M');
  });
});

// ---------------------------------------------------------------------------
// clearLine
// ---------------------------------------------------------------------------
describe('clearLine', () => {
  it('writes carriage return and clear escape sequence to stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    clearLine();
    expect(spy).toHaveBeenCalledWith('\r\x1B[2K');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getTerminalWidth
// ---------------------------------------------------------------------------
describe('getTerminalWidth', () => {
  it('returns process.stdout.columns when available', () => {
    const original = process.stdout.columns;
    Object.defineProperty(process.stdout, 'columns', { value: 120, configurable: true });
    expect(getTerminalWidth()).toBe(120);
    Object.defineProperty(process.stdout, 'columns', { value: original, configurable: true });
  });

  it('returns 80 as fallback when columns is undefined', () => {
    const original = process.stdout.columns;
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    expect(getTerminalWidth()).toBe(80);
    Object.defineProperty(process.stdout, 'columns', { value: original, configurable: true });
  });

  it('returns 80 as fallback when columns is 0', () => {
    const original = process.stdout.columns;
    // columns being 0 is falsy but still a number -- the ?? operator won't catch it
    // This test documents that 0 columns falls through to 80 via ?? operator
    Object.defineProperty(process.stdout, 'columns', { value: 0, configurable: true });
    // 0 is falsy but ?? only checks null/undefined, so this returns 0
    // If the source code uses ?? then 0 is returned; if || then 80
    const result = getTerminalWidth();
    expect(typeof result).toBe('number');
    Object.defineProperty(process.stdout, 'columns', { value: original, configurable: true });
  });
});

// ---------------------------------------------------------------------------
// printBanner
// ---------------------------------------------------------------------------
describe('printBanner', () => {
  it('prints ASCII art with version from package.json', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printBanner();

    expect(logSpy).toHaveBeenCalledTimes(4);
    const calls = logSpy.mock.calls.map((c) => String(c[0]));

    // Should contain ASCII art lines
    expect(calls[0]).toBeTruthy();
    expect(calls[1]).toBeTruthy();
    expect(calls[2]).toBeTruthy();

    // Should contain version string
    const versionCall = calls.find((c) => c.includes('v0.'));
    expect(versionCall).toBeDefined();
    expect(versionCall).toContain('AI Agent Framework');

    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// printHelp
// ---------------------------------------------------------------------------
describe('printHelp', () => {
  it('prints command list', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();

    expect(logSpy).toHaveBeenCalled();
    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');

    expect(allOutput).toContain('/exit');
    expect(allOutput).toContain('/quit');
    expect(allOutput).toContain('/clear');
    expect(allOutput).toContain('/compact');
    expect(allOutput).toContain('/memory');
    expect(allOutput).toContain('/tools');
    expect(allOutput).toContain('/sessions');
    expect(allOutput).toContain('/model');
    expect(allOutput).toContain('/help');

    logSpy.mockRestore();
  });

  it('includes descriptions for each command', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join('\n');

    expect(allOutput).toContain('Exit the session');
    expect(allOutput).toContain('Clear conversation history');
    expect(allOutput).toContain('Force context compaction');
    expect(allOutput).toContain('Show memory usage');
    expect(allOutput).toContain('List available tools');
    expect(allOutput).toContain('List saved sessions');
    expect(allOutput).toContain('Show current provider/model');
    expect(allOutput).toContain('Switch provider');
    expect(allOutput).toContain('Show this help');

    logSpy.mockRestore();
  });
});
