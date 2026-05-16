import type { ChatOptions, ProviderResponse, LLMProvider } from '../provider/types.js';
import type { StructuredOutputConfig, StructuredOutputResult } from './types.js';
import { z } from 'zod';
import { zodToJsonSchema, extractJsonFromText } from './schema.js';
import { resolveStructuredMode, getProviderCapability } from './capabilities.js';
import { injectStructuredPrompt, extractStructuredOutput, buildStructuredErrorMessage } from './extractor.js';

export interface StructuredMeta {
  config: StructuredOutputConfig;
  mode: Exclude<import('./types.js').StructuredMode, 'auto'>;
  jsonSchema: Record<string, unknown>;
  structuredToolName?: string;
}

export class StructuredOutputAdapter {
  adaptChatOptions(provider: LLMProvider, options: ChatOptions): {
    chatOptions: ChatOptions;
    meta: StructuredMeta | null;
  } {
    const config = options.structured;
    if (!config) return { chatOptions: options, meta: null };

    const mode = resolveStructuredMode(provider.name, config.mode ?? 'auto');
    const jsonSchema = zodToJsonSchema(config.schema);

    if (mode === 'prompt_based') {
      return {
        chatOptions: {
          ...options,
          system: injectStructuredPrompt(options.system, jsonSchema, config.description),
        },
        meta: { config, mode, jsonSchema },
      };
    }

    const capability = getProviderCapability(provider.name);
    const name = config.name ?? 'structured_output';

    if (capability === 'json_schema') {
      return {
        chatOptions: {
          ...options,
          response_format: {
            type: 'json_schema',
            json_schema: { name, strict: true, schema: jsonSchema },
          },
        } as ChatOptions,
        meta: { config, mode, jsonSchema },
      };
    }

    if (capability === 'tool_use') {
      const structuredTool = {
        name,
        description: config.description ?? 'Respond with structured output',
        parameters: jsonSchema,
      };
      return {
        chatOptions: {
          ...options,
          tools: [...(options.tools ?? []), structuredTool],
          tool_choice: { type: 'tool', name },
        } as ChatOptions,
        meta: { config, mode, jsonSchema, structuredToolName: name },
      };
    }

    if (capability === 'json_object') {
      return {
        chatOptions: {
          ...options,
          response_format: { type: 'json_object' },
        } as ChatOptions,
        meta: { config, mode, jsonSchema },
      };
    }

    // Fallback to prompt_based
    return {
      chatOptions: {
        ...options,
        system: injectStructuredPrompt(options.system, jsonSchema, config.description),
      },
      meta: { config, mode: 'prompt_based', jsonSchema },
    };
  }

  adaptProviderResponse(
    response: ProviderResponse,
    meta: StructuredMeta | null,
  ): ProviderResponse {
    if (!meta) return response;

    const { config, mode, jsonSchema, structuredToolName } = meta as StructuredMeta & { structuredToolName?: string };

    if (mode === 'provider_native' && structuredToolName && response.toolCalls) {
      const structuredCall = response.toolCalls.find((tc) => tc.name === structuredToolName);
      if (structuredCall) {
        return {
          ...response,
          content: JSON.stringify(structuredCall.arguments),
          toolCalls: response.toolCalls.filter((tc) => tc.name !== structuredToolName),
        };
      }
    }

    return response;
  }

  extractAndValidate<T>(
    response: ProviderResponse,
    meta: StructuredMeta | null,
  ): { success: true; result: StructuredOutputResult<T>; usedMode: string } | { success: false; error: import('zod').ZodError; usedMode: string } {
    const usedMode = meta?.mode ?? 'prompt_based';
    const extracted = extractStructuredOutput<T>(response.content, meta?.config.schema as z.ZodType<T> ?? z.any());
    if (extracted.success) {
      return { success: true, result: { ...extracted.result, mode: usedMode as any }, usedMode };
    }
    return { success: false, error: extracted.error, usedMode };
  }
}
