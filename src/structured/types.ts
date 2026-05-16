import type { z } from 'zod';

export type StructuredMode = 'provider_native' | 'prompt_based' | 'auto';

export interface StructuredOutputConfig {
  schema: z.ZodType;
  mode?: StructuredMode;
  name?: string;
  description?: string;
  maxRetries?: number;
}

export interface StructuredOutputResult<T = unknown> {
  data: T;
  mode: Exclude<StructuredMode, 'auto'>;
  retried: boolean;
  retryCount: number;
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}
