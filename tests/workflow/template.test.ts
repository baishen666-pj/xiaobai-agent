import { describe, it, expect } from 'vitest';
import { renderTemplate, evaluateCondition } from '../../src/workflow/template.js';

describe('renderTemplate', () => {
  it('should replace simple variables', () => {
    expect(renderTemplate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('should replace nested path expressions', () => {
    const ctx = { steps: { analyze: { output: 'found 3 issues' } } };
    expect(renderTemplate('Result: {{steps.analyze.output}}', ctx)).toBe('Result: found 3 issues');
  });

  it('should leave unresolved variables as placeholders', () => {
    expect(renderTemplate('Hello {{unknown}}', {})).toBe('Hello [unknown]');
  });

  it('should handle multiple variables', () => {
    const ctx = { a: '1', b: '2', c: '3' };
    expect(renderTemplate('{{a}}-{{b}}-{{c}}', ctx)).toBe('1-2-3');
  });

  it('should handle empty context', () => {
    expect(renderTemplate('No vars here', {})).toBe('No vars here');
  });

  it('should handle whitespace in expressions', () => {
    expect(renderTemplate('{{ name }}', { name: 'test' })).toBe('test');
  });

  it('should convert non-string values', () => {
    expect(renderTemplate('Count: {{count}}', { count: 42 })).toBe('Count: 42');
  });
});

describe('evaluateCondition', () => {
  it('should evaluate truthy conditions', () => {
    expect(evaluateCondition('x > 5', { x: 10 })).toBe(true);
  });

  it('should evaluate falsy conditions', () => {
    expect(evaluateCondition('x > 5', { x: 3 })).toBe(false);
  });

  it('should evaluate string includes', () => {
    expect(evaluateCondition('text.includes("error")', { text: 'found error in code' })).toBe(true);
  });

  it('should return false on invalid conditions', () => {
    expect(evaluateCondition('???', {})).toBe(false);
  });

  it('should handle undefined variables', () => {
    expect(evaluateCondition('missing > 0', {})).toBe(false);
  });
});
