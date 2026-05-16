import type { LoopEvent } from '../core/loop.js';

export async function collectLoopOutput(
  eventStream: AsyncIterable<LoopEvent>,
  onEvent?: (event: LoopEvent) => void,
): Promise<{ output: string; tokens: number; toolCalls: number }> {
  let output = '';
  let tokens = 0;
  let toolCalls = 0;

  for await (const event of eventStream) {
    onEvent?.(event);

    if (event.type === 'text') output += event.content;
    if (event.type === 'stream') output += event.content;
    if (event.type === 'tool_result') toolCalls++;
    if (event.tokens) tokens += event.tokens;
  }

  return { output, tokens, toolCalls };
}
