import { describe, it, expect, vi } from 'vitest';
import { analyzeFailure, ReflectionOutcomeSchema } from '../../src/core/reflection.js';
import type { ProviderResponse } from '../../src/provider/types.js';
import type { Message } from '../../src/session/manager.js';

describe('ReflectionOutcomeSchema', () => {
  it('validates retry_same strategy', () => {
    const outcome = {
      analysis: 'Transient API error',
      strategy: 'retry_same',
      adjustments: ['Increase timeout'],
    };
    expect(ReflectionOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  it('validates retry_different_role strategy', () => {
    const outcome = {
      analysis: 'Coder lacks context, need research first',
      strategy: 'retry_different_role',
      suggestedRole: 'researcher',
      adjustments: ['Read more files before implementing'],
    };
    expect(ReflectionOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  it('validates retry_simplified strategy', () => {
    const outcome = {
      analysis: 'Task too complex, needs simplification',
      strategy: 'retry_simplified',
      revisedDescription: 'Only fix the import paths',
      adjustments: ['Reduce scope'],
    };
    expect(ReflectionOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  it('validates give_up strategy', () => {
    const outcome = {
      analysis: 'Impossible requirement',
      strategy: 'give_up',
      adjustments: [],
    };
    expect(ReflectionOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  it('rejects invalid strategy', () => {
    const outcome = {
      analysis: 'test',
      strategy: 'unknown',
      adjustments: [],
    };
    expect(() => ReflectionOutcomeSchema.parse(outcome)).toThrow();
  });

  it('rejects missing adjustments', () => {
    const outcome = {
      analysis: 'test',
      strategy: 'retry_same',
    };
    expect(() => ReflectionOutcomeSchema.parse(outcome)).toThrow();
  });
});

describe('analyzeFailure', () => {
  const validOutcome = {
    analysis: 'The code change introduced a type error',
    strategy: 'retry_simplified',
    revisedDescription: 'Fix only the type annotations',
    adjustments: ['Focus on type fixes only'],
  };

  it('analyzes a failure and returns structured outcome', async () => {
    const mockFn = vi.fn<() => Promise<ProviderResponse>>().mockResolvedValue({
      content: JSON.stringify(validOutcome),
    });

    const result = await analyzeFailure(mockFn, 'Implement auth module', 'Type error in line 42', 'Partial code...');
    expect(result.strategy).toBe('retry_simplified');
    expect(result.revisedDescription).toBe('Fix only the type annotations');
  });

  it('includes task description and error in LLM messages', async () => {
    const mockFn = vi.fn<() => Promise<ProviderResponse>>().mockResolvedValue({
      content: JSON.stringify(validOutcome),
    });

    await analyzeFailure(mockFn, 'Build the dashboard', 'Build failed: missing dependency', 'No output');

    const [messages] = mockFn.mock.calls[0];
    expect(messages[0].content).toContain('Build the dashboard');
    expect(messages[0].content).toContain('Build failed: missing dependency');
  });

  it('truncates long output to 2000 chars', async () => {
    const mockFn = vi.fn<() => Promise<ProviderResponse>>().mockResolvedValue({
      content: JSON.stringify(validOutcome),
    });

    const longOutput = 'x'.repeat(5000);
    await analyzeFailure(mockFn, 'Task', 'Error', longOutput);

    const [messages] = mockFn.mock.calls[0];
    expect(messages[0].content).toContain('x'.repeat(2000));
    expect(messages[0].content).not.toContain('x'.repeat(2001));
  });

  it('handles retry_different_role strategy', async () => {
    const mockFn = vi.fn<() => Promise<ProviderResponse>>().mockResolvedValue({
      content: JSON.stringify({
        analysis: 'Need research first',
        strategy: 'retry_different_role',
        suggestedRole: 'researcher',
        adjustments: ['Gather more context'],
      }),
    });

    const result = await analyzeFailure(mockFn, 'Write tests', 'Missing test files', '');
    expect(result.strategy).toBe('retry_different_role');
    expect(result.suggestedRole).toBe('researcher');
  });
});
