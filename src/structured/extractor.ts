import { z } from 'zod';
import { extractJsonFromText } from './schema.js';
import type { StructuredOutputResult } from './types.js';

export function injectStructuredPrompt(
  system: string | undefined,
  jsonSchema: Record<string, unknown>,
  description?: string,
): string {
  const base = system ? system + '\n\n' : '';
  const desc = description ? `Purpose: ${description}\n\n` : '';
  return (
    base +
    desc +
    'You must respond with valid JSON that conforms to the following JSON Schema:\n\n' +
    '<schema>\n' +
    JSON.stringify(jsonSchema, null, 2) +
    '\n</schema>\n\n' +
    'IMPORTANT:\n' +
    '- Respond ONLY with the JSON object. No markdown, no explanation, no code fences.\n' +
    '- The response must be a single JSON object, not an array.'
  );
}

export function extractStructuredOutput<T>(
  content: string | undefined,
  schema: z.ZodType<T>,
): { success: true; result: StructuredOutputResult<T> } | { success: false; error: z.ZodError } {
  if (!content) return { success: false, error: new z.ZodError([]) };

  const parsed = extractJsonFromText(content);
  if (parsed === null) {
    return {
      success: false,
      error: new z.ZodError([{ code: 'custom', path: [], message: 'No valid JSON found in response' }]),
    };
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) return { success: false, error: validated.error };

  return {
    success: true,
    result: { data: validated.data, mode: 'prompt_based', retried: false, retryCount: 0 },
  };
}

export function buildStructuredErrorMessage(error: import('zod').ZodError): string {
  const issues = error.issues
    .slice(0, 5)
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  return `The JSON you returned is invalid:\n${issues}\n\nPlease respond again with valid JSON matching the schema.`;
}
