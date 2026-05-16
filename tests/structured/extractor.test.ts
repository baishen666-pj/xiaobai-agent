import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  injectStructuredPrompt,
  extractStructuredOutput,
  buildStructuredErrorMessage,
} from '../../src/structured/extractor.js';

// ---------------------------------------------------------------------------
// injectStructuredPrompt
// ---------------------------------------------------------------------------

describe('injectStructuredPrompt', () => {
  const simpleSchema = { type: 'object', properties: { name: { type: 'string' } } };

  it('appends schema instruction to an existing system prompt', () => {
    const result = injectStructuredPrompt('You are a helper.', simpleSchema);

    expect(result).toContain('You are a helper.');
    expect(result).toContain('You must respond with valid JSON');
    expect(result).toContain('<schema>');
    expect(result).toContain('"type": "object"');
    expect(result).toContain('</schema>');
    expect(result).toContain('Respond ONLY with the JSON object');
  });

  it('works without a system prompt (undefined)', () => {
    const result = injectStructuredPrompt(undefined, simpleSchema);

    expect(result).not.toContain('undefined');
    expect(result).toContain('You must respond with valid JSON');
    expect(result).toContain('<schema>');
  });

  it('includes the description when provided', () => {
    const result = injectStructuredPrompt('System', simpleSchema, 'Extract user data');

    expect(result).toContain('Purpose: Extract user data');
  });

  it('omits the description line when not provided', () => {
    const result = injectStructuredPrompt('System', simpleSchema);

    expect(result).not.toContain('Purpose:');
  });

  it('formats the JSON schema with indentation', () => {
    const result = injectStructuredPrompt(undefined, simpleSchema);

    // The schema should be pretty-printed (2-space indent)
    expect(result).toContain('{\n  "type": "object"');
  });

  it('preserves all parts of the original system prompt', () => {
    const result = injectStructuredPrompt('Line1\nLine2\nLine3', simpleSchema);

    expect(result).toContain('Line1\nLine2\nLine3');
  });
});

// ---------------------------------------------------------------------------
// extractStructuredOutput
// ---------------------------------------------------------------------------

describe('extractStructuredOutput', () => {
  const personSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  it('returns success for valid JSON matching the schema', () => {
    const result = extractStructuredOutput('{"name": "Alice", "age": 30}', personSchema);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.data).toEqual({ name: 'Alice', age: 30 });
    }
  });

  it('returns success for JSON wrapped in code block', () => {
    const result = extractStructuredOutput(
      '```json\n{"name": "Bob", "age": 25}\n```',
      personSchema,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.data).toEqual({ name: 'Bob', age: 25 });
    }
  });

  it('returns failure for invalid JSON', () => {
    const result = extractStructuredOutput('not json at all', personSchema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it('returns failure for JSON that does not match schema', () => {
    const result = extractStructuredOutput('{"name": 123}', personSchema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });

  it('returns failure for undefined content', () => {
    const result = extractStructuredOutput(undefined, personSchema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });

  it('returns failure for empty string content', () => {
    const result = extractStructuredOutput('', personSchema);

    expect(result.success).toBe(false);
  });

  it('returns failure with "No valid JSON" message when JSON cannot be extracted', () => {
    const result = extractStructuredOutput('plain text no json', personSchema);

    expect(result.success).toBe(false);
    if (!result.success) {
      const hasNoJsonMsg = result.error.issues.some(
        (issue) => issue.message === 'No valid JSON found in response',
      );
      expect(hasNoJsonMsg).toBe(true);
    }
  });

  it('handles extra fields correctly based on schema strictness', () => {
    const strictSchema = z.object({ name: z.string() }).strict();
    const result = extractStructuredOutput('{"name": "X", "extra": 1}', strictSchema);

    // strict schema should reject extra fields
    expect(result.success).toBe(false);
  });

  it('handles partial schema (missing required fields)', () => {
    const result = extractStructuredOutput('{"name": "Alice"}', personSchema);

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildStructuredErrorMessage
// ---------------------------------------------------------------------------

describe('buildStructuredErrorMessage', () => {
  it('generates a readable error message from ZodError', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const parseResult = schema.safeParse({ name: 123, age: 'not_a_number' });
    if (parseResult.success) {
      throw new Error('Expected parse failure');
    }

    const message = buildStructuredErrorMessage(parseResult.error);

    expect(message).toContain('The JSON you returned is invalid');
    expect(message).toContain('Please respond again with valid JSON');
    // Should mention field paths
    expect(message).toContain('name');
    expect(message).toContain('age');
  });

  it('limits displayed issues to at most 5', () => {
    const schema = z.object({
      f1: z.string(), f2: z.string(), f3: z.string(), f4: z.string(), f5: z.string(), f6: z.string(),
    });
    const parseResult = schema.safeParse({ f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6 });
    if (parseResult.success) {
      throw new Error('Expected parse failure');
    }

    const message = buildStructuredErrorMessage(parseResult.error);

    // Count the bullet points
    const bulletCount = (message.match(/- /g) || []).length;
    expect(bulletCount).toBeLessThanOrEqual(5);
  });

  it('handles empty ZodError', () => {
    const emptyError = new z.ZodError([]);

    const message = buildStructuredErrorMessage(emptyError);

    expect(message).toContain('The JSON you returned is invalid');
    expect(message).toContain('Please respond again with valid JSON');
  });

  it('formats nested path with dots', () => {
    const schema = z.object({ user: z.object({ email: z.string().email() }) });
    const parseResult = schema.safeParse({ user: { email: 'not-an-email' } });
    if (parseResult.success) {
      throw new Error('Expected parse failure');
    }

    const message = buildStructuredErrorMessage(parseResult.error);

    expect(message).toContain('user.email');
  });
});
