import type { Message } from '../session/manager.js';
import type { ProviderRouter } from '../provider/router.js';
import { extractText } from '../types/content-types.js';

const CHARS_PER_TOKEN = 4;

export interface CompactionConfig {
  maxContextTokens: number;
  compressionThreshold: number;
  keepLastN: number;
  summaryMaxTokens: number;
}

export interface CompactionResult {
  messages: Message[];
  summary: string;
  originalCount: number;
  compactedCount: number;
  savedTokens: number;
}

export class CompactionEngine {
  private provider: ProviderRouter;
  private config: CompactionConfig;

  constructor(provider: ProviderRouter, config: Partial<CompactionConfig> = {}) {
    this.provider = provider;
    this.config = {
      maxContextTokens: 100_000,
      compressionThreshold: 0.5,
      keepLastN: 20,
      summaryMaxTokens: 2000,
      ...config,
    };
  }

  shouldCompact(messages: Message[], totalTokens: number, lastCompactTokens: number): boolean {
    const threshold = this.config.maxContextTokens * this.config.compressionThreshold;
    const estimatedTokens = totalTokens > 0 ? totalTokens : this.estimateTokens(messages);
    return estimatedTokens - lastCompactTokens > threshold;
  }

  async compact(messages: Message[]): Promise<CompactionResult> {
    const keepLast = this.config.keepLastN;
    const originalCount = messages.length;

    if (originalCount <= keepLast) {
      return {
        messages,
        summary: '',
        originalCount,
        compactedCount: originalCount,
        savedTokens: 0,
      };
    }

    const oldMessages = messages.slice(0, -keepLast);
    const recentMessages = messages.slice(-keepLast);

    const summary = await this.generateSummary(oldMessages);
    const summaryMessage: Message = {
      role: 'system',
      content: `[Previous Context Summary]\n${summary}`,
    };

    const compacted = [summaryMessage, ...recentMessages];
    const savedTokens = this.estimateTokens(oldMessages) - this.estimateTokens([summaryMessage]);

    return {
      messages: compacted,
      summary,
      originalCount,
      compactedCount: compacted.length,
      savedTokens: Math.max(0, savedTokens),
    };
  }

  estimateTokens(messages: Message[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += extractText(msg.content).length;
      if (msg.toolCallId) totalChars += msg.toolCallId.length;
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          totalChars += (tc.name?.length ?? 0) + JSON.stringify(tc.arguments).length;
        }
      }
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
  }

  private async generateSummary(messages: Message[]): Promise<string> {
    const conversationText = messages
      .map((m) => {
        const prefix = m.role === 'system' ? 'SYSTEM' : m.role === 'assistant' ? 'ASSISTANT' : m.role === 'user' ? 'USER' : 'TOOL';
        const suffix = m.toolCallId ? ` (tool: ${m.toolCallId})` : '';
        return `[${prefix}${suffix}]: ${extractText(m.content).slice(0, 500)}`;
      })
      .join('\n');

    try {
      const response = await this.provider.chat(
        [
          {
            role: 'system',
            content:
              'Create a concise summary of this conversation. Preserve:\n' +
              '- Key decisions and rationale\n' +
              '- Important data, numbers, identifiers\n' +
              '- Tool calls made and results\n' +
              '- Current task state and next steps\n' +
              'Be factual and terse. No filler.',
          },
          { role: 'user', content: conversationText },
        ],
        { maxTokens: this.config.summaryMaxTokens },
      );
      return response?.content ?? 'Context summary unavailable';
    } catch (e) {
      console.debug('compaction: summary generation failed, using fallback', (e as Error).message);
      return this.fallbackSummary(messages);
    }
  }

  private fallbackSummary(messages: Message[]): string {
    const toolCalls = messages.filter((m) => m.role === 'assistant' && extractText(m.content).includes('tool'));
    const userMessages = messages.filter((m) => m.role === 'user');
    return (
      `[Auto-summary: ${messages.length} messages, ${userMessages.length} user turns, ${toolCalls.length} tool interactions]`
    );
  }
}
