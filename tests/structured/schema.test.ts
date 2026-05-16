import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema, wrapSchemaForOpenAI, extractJsonFromText } from '../../src/structured/schema.js';

// ---------------------------------------------------------------------------
// zodToJsonSchema
// ---------------------------------------------------------------------------

describe('zodToJsonSchema', () => {
  it('converts a simple object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = zodToJsonSchema(schema);

    expect(result.type).toBe('object');
    expect((result as any).properties).toBeDefined();
    expect((result as any).properties.name).toBeDefined();
    expect((result as any).properties.age).toBeDefined();
    expect((result as any).required).toContain('name');
    expect((result as any).required).toContain('age');
  });

  it('converts a nested object schema', () => {
    const schema = z.object({
      user: z.object({
        profile: z.object({
          bio: z.string(),
        }),
      }),
    });

    const result = zodToJsonSchema(schema);

    expect(result.type).toBe('object');
    const userProp = (result as any).properties.user;
    expect(userProp.type).toBe('object');
    expect((userProp as any).properties.profile.type).toBe('object');
    expect(((userProp as any).properties.profile as any).properties.bio).toBeDefined();
  });

  it('converts an array schema', () => {
    const schema = z.object({
      items: z.array(z.string()),
    });

    const result = zodToJsonSchema(schema);

    const itemsProp = (result as any).properties.items;
    expect(itemsProp.type).toBe('array');
    expect(itemsProp.items.type).toBe('string');
  });

  it('converts an enum schema', () => {
    const schema = z.object({
      status: z.enum(['active', 'inactive', 'pending']),
    });

    const result = zodToJsonSchema(schema);

    const statusProp = (result as any).properties.status;
    expect(statusProp.enum).toEqual(['active', 'inactive', 'pending']);
  });

  it('handles optional fields', () => {
    const schema = z.object({
      required_field: z.string(),
      optional_field: z.string().optional(),
    });

    const result = zodToJsonSchema(schema);

    expect((result as any).required).toContain('required_field');
    expect((result as any).required).not.toContain('optional_field');
  });

  it('handles a primitive schema (string)', () => {
    const result = zodToJsonSchema(z.string());

    expect(result.type).toBe('string');
  });

  it('handles a union type', () => {
    const schema = z.object({
      value: z.union([z.string(), z.number()]),
    });

    const result = zodToJsonSchema(schema);

    const valueProp = (result as any).properties.value;
    expect(valueProp).toBeDefined();
    // zod-to-json-schema converts unions to anyOf
    expect(valueProp.anyOf || valueProp.oneOf).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// wrapSchemaForOpenAI
// ---------------------------------------------------------------------------

describe('wrapSchemaForOpenAI', () => {
  it('wraps a JSON schema with the correct OpenAI structure', () => {
    const jsonSchema = { type: 'object', properties: { name: { type: 'string' } } };

    const result = wrapSchemaForOpenAI(jsonSchema, 'test_schema');

    expect(result.type).toBe('json_schema');
    expect(result.json_schema.name).toBe('test_schema');
    expect(result.json_schema.strict).toBe(true);
    expect(result.json_schema.schema).toBe(jsonSchema);
  });

  it('uses the provided name', () => {
    const result = wrapSchemaForOpenAI({}, 'my_custom_name');
    expect(result.json_schema.name).toBe('my_custom_name');
  });
});

// ---------------------------------------------------------------------------
// extractJsonFromText
// ---------------------------------------------------------------------------

describe('extractJsonFromText', () => {
  // --- Direct JSON parsing ---

  it('parses a plain JSON object', () => {
    const result = extractJsonFromText('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('parses a plain JSON array', () => {
    const result = extractJsonFromText('[1, 2, 3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('parses JSON with whitespace around it', () => {
    const result = extractJsonFromText('  \n  {"a": 1}  \n  ');
    expect(result).toEqual({ a: 1 });
  });

  // --- Code block extraction ---

  it('extracts JSON from a markdown code block with json tag', () => {
    const text = 'Here is the result:\n```json\n{"status": "ok"}\n```';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ status: 'ok' });
  });

  it('extracts JSON from a markdown code block without language tag', () => {
    const text = '```\n{"status": "ok"}\n```';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ status: 'ok' });
  });

  // --- Text with prefix/suffix ---

  it('extracts JSON surrounded by prose text', () => {
    const text = 'The result is {"x": 42} and that is final.';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ x: 42 });
  });

  it('extracts JSON with nested braces from surrounding text', () => {
    const text = 'Output: {"a": {"b": 1}, "c": 2} done';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ a: { b: 1 }, c: 2 });
  });

  // --- Array extraction from surrounding text ---

  it('extracts a JSON array from surrounding text', () => {
    const text = 'Result: [1, 2, 3] end';
    const result = extractJsonFromText(text);
    expect(result).toEqual([1, 2, 3]);
  });

  // --- Edge cases ---

  it('returns null for empty string', () => {
    expect(extractJsonFromText('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(extractJsonFromText('   \n\t  ')).toBeNull();
  });

  it('returns null for text without any JSON', () => {
    expect(extractJsonFromText('This is just plain text with no JSON.')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractJsonFromText('{not valid json}')).toBeNull();
  });

  it('returns null for empty code block', () => {
    expect(extractJsonFromText('```\n```')).toBeNull();
  });

  it('handles JSON with special characters', () => {
    const result = extractJsonFromText('{"emoji": "\\u2764", "quote": "hello \\"world\\""}');
    expect(result).toEqual({ emoji: '❤', quote: 'hello "world"' });
  });

  it('handles deeply nested JSON', () => {
    const deep = { a: { b: { c: { d: { e: 'deep' } } } } };
    const result = extractJsonFromText(JSON.stringify(deep));
    expect(result).toEqual(deep);
  });

  it('handles JSON with Unicode characters', () => {
    const result = extractJsonFromText('{"name": "你好"}');
    expect(result).toEqual({ name: '你好' });
  });

  it('returns null for text with brackets that are not valid JSON', () => {
    // This exercises the catch block in the bracket-extraction path (line 51)
    const result = extractJsonFromText('Result: [not, valid, {json}] end');
    expect(result).toBeNull();
  });

  it('returns null for text with braces that are not valid JSON and no brackets', () => {
    // Text that has braces but they do not form valid JSON, and no brackets either
    const result = extractJsonFromText('{no valid json here}');
    expect(result).toBeNull();
  });
});
