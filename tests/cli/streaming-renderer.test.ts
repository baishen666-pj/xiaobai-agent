import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingMarkdownRenderer } from '../../src/cli/streaming-renderer.js';

describe('StreamingMarkdownRenderer', () => {
  let renderer: StreamingMarkdownRenderer;
  let output: string[];

  beforeEach(() => {
    renderer = new StreamingMarkdownRenderer();
    output = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    });
  });

  it('push processes text lines', () => {
    renderer.push('hello world\n');
    expect(output.length).toBeGreaterThan(0);
    expect(output.join('')).toContain('hello world');
  });

  it('push buffers incomplete lines', () => {
    renderer.push('incomplete');
    expect(output.length).toBe(0);
    renderer.push(' line\n');
    expect(output.length).toBeGreaterThan(0);
    expect(output.join('')).toContain('incomplete line');
  });

  it('flush outputs remaining buffer', () => {
    renderer.push('remaining text');
    renderer.flush();
    expect(output.length).toBeGreaterThan(0);
    expect(output.join('')).toContain('remaining text');
  });

  it('flush closes open code blocks', () => {
    renderer.push('```js\n');
    renderer.push('const x = 1;\n');
    renderer.flush();
    expect(output.some((o) => o.includes('const x = 1;'))).toBe(true);
  });

  it('reset clears internal state', () => {
    renderer.push('```js\n');
    renderer.reset();
    renderer.push('not code\n');
    expect(output.some((o) => o.includes('not code'))).toBe(true);
  });

  it('renders markdown headers', () => {
    renderer.push('# Header 1\n');
    expect(output.some((o) => o.includes('Header 1'))).toBe(true);
  });

  it('renders h2 headers', () => {
    renderer.push('## Header 2\n');
    expect(output.some((o) => o.includes('Header 2'))).toBe(true);
  });

  it('renders h3 headers', () => {
    renderer.push('### Header 3\n');
    expect(output.some((o) => o.includes('Header 3'))).toBe(true);
  });

  it('renders list items', () => {
    renderer.push('- item one\n');
    expect(output.some((o) => o.includes('item one'))).toBe(true);
  });

  it('renders numbered lists', () => {
    renderer.push('1. first item\n');
    expect(output.some((o) => o.includes('first item'))).toBe(true);
  });

  it('renders blockquotes', () => {
    renderer.push('> quoted text\n');
    expect(output.some((o) => o.includes('quoted text'))).toBe(true);
  });

  it('renders inline bold', () => {
    renderer.push('this is **bold** text\n');
    expect(output.some((o) => o.includes('bold'))).toBe(true);
  });

  it('renders inline code', () => {
    renderer.push('use `console.log` to debug\n');
    expect(output.some((o) => o.includes('console.log'))).toBe(true);
  });

  it('renders inline links', () => {
    renderer.push('[click here](https://example.com)\n');
    expect(output.some((o) => o.includes('click here'))).toBe(true);
    expect(output.some((o) => o.includes('https://example.com'))).toBe(true);
  });

  it('handles code blocks with language', () => {
    renderer.push('```typescript\n');
    renderer.push('const x: number = 1;\n');
    renderer.push('```\n');
    expect(output.some((o) => o.includes('const x'))).toBe(true);
  });

  it('handles code blocks without language', () => {
    renderer.push('```\n');
    renderer.push('plain text code\n');
    renderer.push('```\n');
    expect(output.some((o) => o.includes('plain text code'))).toBe(true);
  });

  it('handles empty code blocks', () => {
    renderer.push('```\n```\n');
  });

  it('renders table rows', () => {
    renderer.push('| header | value |\n');
    expect(output.some((o) => o.includes('header'))).toBe(true);
  });

  it('handles multiple lines in sequence', () => {
    renderer.push('line 1\nline 2\nline 3\n');
    expect(output.filter((o) => o.includes('line')).length).toBeGreaterThanOrEqual(3);
  });

  it('handles empty lines', () => {
    renderer.push('\n');
  });
});
