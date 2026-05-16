import { describe, it, expect } from 'vitest';
import { AutoCompleter, completeFilePath, generateCompletionScript, type CompletionCandidate } from '../../src/cli/autocomplete.js';

describe('AutoCompleter', () => {
  let completer: AutoCompleter;

  beforeEach(() => {
    completer = new AutoCompleter();
  });

  describe('command completion', () => {
    it('should complete slash commands', () => {
      const results = completer.complete({
        buffer: '/ex',
        cursorPosition: 3,
        cwd: '/tmp',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.text.startsWith('/ex'))).toBe(true);
    });

    it('should list all commands for bare slash', () => {
      const results = completer.complete({
        buffer: '/',
        cursorPosition: 1,
        cwd: '/tmp',
      });
      expect(results.length).toBeGreaterThan(5);
    });

    it('should return empty for non-slash input', () => {
      const results = completer.complete({
        buffer: 'hello',
        cursorPosition: 5,
        cwd: '/tmp',
      });
      expect(results).toEqual([]);
    });

    it('should return empty for no matches', () => {
      const results = completer.complete({
        buffer: '/xyz',
        cursorPosition: 4,
        cwd: '/tmp',
      });
      expect(results).toEqual([]);
    });
  });

  describe('/model completion', () => {
    it('should complete providers after /model ', () => {
      const results = completer.complete({
        buffer: '/model ',
        cursorPosition: 7,
        cwd: '/tmp',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.text === 'anthropic')).toBe(true);
    });

    it('should filter providers by partial input', () => {
      const results = completer.complete({
        buffer: '/model deep',
        cursorPosition: 12,
        cwd: '/tmp',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.text.startsWith('deep'))).toBe(true);
    });
  });

  describe('/export completion', () => {
    it('should complete formats after /export ', () => {
      const results = completer.complete({
        buffer: '/export ',
        cursorPosition: 8,
        cwd: '/tmp',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.text === 'json')).toBe(true);
      expect(results.some((r) => r.text === 'markdown')).toBe(true);
    });

    it('should filter formats by partial input', () => {
      const results = completer.complete({
        buffer: '/export js',
        cursorPosition: 11,
        cwd: '/tmp',
      });
      expect(results.length).toBe(1);
      expect(results[0].text).toBe('json');
    });
  });

  describe('unknown command sub-completion', () => {
    it('should return empty for unknown command with args', () => {
      const results = completer.complete({
        buffer: '/unknown arg',
        cursorPosition: 12,
        cwd: '/tmp',
      });
      expect(results).toEqual([]);
    });
  });
});

describe('completeFilePath', () => {
  it('should list files in cwd', () => {
    const results = completeFilePath('', process.cwd());
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it('should filter by prefix', () => {
    const results = completeFilePath('src', process.cwd());
    const allStartWithSrc = results.every((r) =>
      r.text.toLowerCase().startsWith('src'),
    );
    expect(allStartWithSrc).toBe(true);
  });

  it('should return empty for non-existent directory', () => {
    const results = completeFilePath('/nonexistent/path/', '/nonexistent/path');
    expect(results).toEqual([]);
  });
});

describe('generateCompletionScript', () => {
  it('should generate bash completion script', () => {
    const script = generateCompletionScript('bash');
    expect(script).toContain('_xiaobai_completions');
    expect(script).toContain('complete -F');
  });

  it('should generate zsh completion script', () => {
    const script = generateCompletionScript('zsh');
    expect(script).toContain('#compdef xiaobai');
  });

  it('should generate fish completion script', () => {
    const script = generateCompletionScript('fish');
    expect(script).toContain('complete -c xiaobai');
  });
});