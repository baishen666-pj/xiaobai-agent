export type { StructuredMode, StructuredOutputConfig, StructuredOutputResult } from './types.js';
export { StructuredOutputError } from './types.js';
export { zodToJsonSchema, extractJsonFromText } from './schema.js';
export { getProviderCapability, resolveStructuredMode } from './capabilities.js';
export { injectStructuredPrompt, extractStructuredOutput, buildStructuredErrorMessage } from './extractor.js';
export { StructuredOutputAdapter } from './adapter.js';

import type { Message } from '../session/manager.js';
import type { ChatOptions, ProviderResponse, LLMProvider } from '../provider/types.js';
import type { StructuredOutputConfig, StructuredOutputResult } from './types.js';
import { StructuredOutputError } from './types.js';
import { StructuredOutputAdapter } from './adapter.js';
import { extractStructuredOutput, buildStructuredErrorMessage } from './extractor.js';

const adapter = new StructuredOutputAdapter();

export async function structuredChat<T = unknown>(
  chatFn: (messages: Message[], options: ChatOptions) => Promise<ProviderResponse | null>,
  messages: Message[],
  config: StructuredOutputConfig,
  options: ChatOptions = {},
): Promise<StructuredOutputResult<T>> {
  const maxRetries = config.maxRetries ?? 2;
  const workingMessages = [...messages];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const stubProvider: LLMProvider = { name: '', chat: async () => ({ content: '' }) };
    const adapted = adapter.adaptChatOptions(
      stubProvider,
      { ...options, structured: config },
    );

    const response = await chatFn(workingMessages, adapted.chatOptions);
    if (!response) continue;

    const finalResponse = adapter.adaptProviderResponse(response, adapted.meta);
    const extracted = extractStructuredOutput<T>(finalResponse.content, config.schema);

    if (extracted.success) {
      return {
        ...extracted.result,
        mode: adapted.meta?.mode ?? 'prompt_based',
        retried: attempt > 0,
        retryCount: attempt,
      };
    }

    if (attempt < maxRetries) {
      workingMessages.push(
        { role: 'assistant', content: response.content ?? '' },
        { role: 'user', content: buildStructuredErrorMessage(extracted.error) },
      );
    }
  }

  throw new StructuredOutputError(
    `Failed to get valid structured output after ${maxRetries + 1} attempts`,
    null,
    maxRetries + 1,
  );
}
