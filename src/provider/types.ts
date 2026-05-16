import type { Message } from '../session/manager.js';
import type { ToolDefinition } from '../tools/registry.js';
import type { StructuredOutputConfig } from '../structured/types.js';

export interface ProviderResponse {
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export interface StreamChunk {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'usage' | 'done';
  text?: string;
  toolCallId?: string;
  toolCallName?: string;
  toolCallDelta?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  stopReason?: string;
}

export interface ChatOptions {
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  abortSignal?: AbortSignal;
  structured?: StructuredOutputConfig;
  /** @internal Used by structured output adapter */
  response_format?: Record<string, unknown>;
  /** @internal Used by structured output adapter */
  tool_choice?: Record<string, unknown>;
}

export interface ProviderConfig {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  apiMode?: 'chat-completions' | 'responses' | 'anthropic' | 'google';
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: Message[], model: string, options: ChatOptions): Promise<ProviderResponse>;
  chatStream?(messages: Message[], model: string, options: ChatOptions): AsyncGenerator<StreamChunk, void, void>;
}
