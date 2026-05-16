import { zodToJsonSchema as convert } from 'zod-to-json-schema';
import type { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return convert(schema, { target: 'openApi3' }) as Record<string, unknown>;
}

export function wrapSchemaForOpenAI(
  jsonSchema: Record<string, unknown>,
  name: string,
): { type: 'json_schema'; json_schema: { name: string; strict: true; schema: Record<string, unknown> } } {
  return {
    type: 'json_schema',
    json_schema: { name, strict: true, schema: jsonSchema },
  };
}

export function extractJsonFromText(text: string): unknown | null {
  if (!text || !text.trim()) return null;

  const trimmed = text.trim();

  // Direct parse
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }

  // Strip markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* continue */ }
  }

  // Find outermost balanced braces
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch { /* continue */ }
  }

  // Try brackets for arrays
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    } catch { /* continue */ }
  }

  return null;
}
