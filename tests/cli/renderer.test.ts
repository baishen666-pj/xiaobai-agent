import { describe, it, expect } from 'vitest';
import { renderMarkdown, formatToolCall, formatTokenUsage } from '../../src/cli/renderer.js';

describe('renderMarkdown', () => {
  it('renders bold text', () => {
    const result = renderMarkdown('This is **bold** text');
    expect(result).toContain('bold');
    expect(result).not.toContain('**');
  });

  it('renders inline code', () => {
    const result = renderMarkdown('Use `console.log` here');
    expect(result).toContain('console.log');
    expect(result).not.toContain('`');
  });

  it('renders headers', () => {
    const result = renderMarkdown('# Title\n## Subtitle\n### Small');
    expect(result).toContain('Title');
    expect(result).toContain('Subtitle');
    expect(result).toContain('Small');
  });

  it('renders list items', () => {
    const result = renderMarkdown('- item one\n- item two');
    expect(result).toContain('item one');
    expect(result).toContain('item two');
    expect(result).toContain('•');
  });

  it('renders code blocks', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result).toContain('const x = 1');
  });

  it('renders blockquotes', () => {
    const result = renderMarkdown('> quoted text');
    expect(result).toContain('quoted text');
  });

  it('renders links', () => {
    const result = renderMarkdown('[click here](https://example.com)');
    expect(result).toContain('click here');
    expect(result).toContain('https://example.com');
  });

  it('passes through plain text unchanged', () => {
    const result = renderMarkdown('just plain text');
    expect(result).toContain('just plain text');
  });
});

describe('formatToolCall', () => {
  it('formats bash tool compactly', () => {
    const result = formatToolCall({
      name: 'bash',
      args: { command: 'echo hello world' },
      result: { success: true, output: 'hello world' },
    });
    expect(result).toContain('bash');
    expect(result).toContain('echo hello world');
    expect(result).toContain('✓');
  });

  it('formats read tool with path', () => {
    const result = formatToolCall({
      name: 'read',
      args: { file_path: '/some/path/file.ts' },
    });
    expect(result).toContain('read');
    expect(result).toContain('/some/path/file.ts');
  });

  it('shows failure marker', () => {
    const result = formatToolCall({
      name: 'write',
      args: { file_path: '/blocked' },
      result: { success: false, output: 'denied' },
    });
    expect(result).toContain('✗');
  });
});

describe('formatTokenUsage', () => {
  it('formats small numbers', () => {
    expect(formatTokenUsage(500)).toBe('500');
  });

  it('formats thousands', () => {
    expect(formatTokenUsage(2500)).toBe('2.5k');
  });

  it('formats millions', () => {
    expect(formatTokenUsage(1500000)).toBe('1.5M');
  });
});
