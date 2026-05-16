import type { Message } from './types.js';
import type { TokenUsageSummary } from './token-tracker.js';
import type { MetricsSnapshot } from './metrics.js';

export interface ExportData {
  version: string;
  exportedAt: string;
  session: {
    id: string;
    messages: Message[];
    turnCount: number;
    startedAt?: string;
    completedAt?: string;
  };
  tokenUsage?: TokenUsageSummary;
  metrics?: MetricsSnapshot;
}

export type ExportFormat = 'json' | 'markdown';

export function exportToJson(data: ExportData): string {
  const serializable = {
    version: data.version,
    exportedAt: data.exportedAt,
    session: {
      id: data.session.id,
      turnCount: data.session.turnCount,
      startedAt: data.session.startedAt,
      completedAt: data.session.completedAt,
      messages: data.session.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
        ...(m.toolResults ? { toolResults: m.toolResults } : {}),
      })),
    },
    ...(data.tokenUsage ? { tokenUsage: data.tokenUsage } : {}),
    ...(data.metrics ? { metrics: data.metrics } : {}),
  };

  return JSON.stringify(serializable, null, 2);
}

export function exportToMarkdown(data: ExportData): string {
  const lines: string[] = [];

  lines.push(`# Session Export`);
  lines.push('');
  lines.push(`- **Session ID**: ${data.session.id}`);
  lines.push(`- **Exported**: ${data.exportedAt}`);
  lines.push(`- **Turns**: ${data.session.turnCount}`);
  if (data.session.startedAt) {
    lines.push(`- **Started**: ${data.session.startedAt}`);
  }
  if (data.session.completedAt) {
    lines.push(`- **Completed**: ${data.session.completedAt}`);
  }
  lines.push('');

  if (data.tokenUsage) {
    lines.push(`## Token Usage`);
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Tokens | ${data.tokenUsage.totalTokens.toLocaleString()} |`);
    lines.push(`| Prompt Tokens | ${data.tokenUsage.totalPromptTokens.toLocaleString()} |`);
    lines.push(`| Completion Tokens | ${data.tokenUsage.totalCompletionTokens.toLocaleString()} |`);
    lines.push(`| Total Cost | $${data.tokenUsage.totalCost.toFixed(4)} |`);
    lines.push('');

    if (data.tokenUsage.byModel.size > 0) {
      lines.push(`### By Model`);
      lines.push('');
      lines.push(`| Model | Tokens | Cost |`);
      lines.push(`|-------|--------|------|`);
      for (const [model, info] of data.tokenUsage.byModel) {
        lines.push(`| ${model} | ${info.tokens.toLocaleString()} | $${info.cost.toFixed(4)} |`);
      }
      lines.push('');
    }
  }

  if (data.metrics) {
    lines.push(`## Metrics`);
    lines.push('');
    const uptimeSec = (data.metrics.uptime / 1000).toFixed(1);
    lines.push(`- **Uptime**: ${uptimeSec}s`);

    if (Object.keys(data.metrics.counters).length > 0) {
      lines.push('');
      lines.push(`### Counters`);
      for (const [name, value] of Object.entries(data.metrics.counters)) {
        lines.push(`- ${name}: ${value}`);
      }
    }

    if (Object.keys(data.metrics.histograms).length > 0) {
      lines.push('');
      lines.push(`### Latency`);
      for (const [, summary] of Object.entries(data.metrics.histograms)) {
        const s = summary as { name: string; count: number; mean: number; p95: number; p99: number };
        lines.push(`- ${s.name}: count=${s.count} mean=${s.mean.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms p99=${s.p99.toFixed(2)}ms`);
      }
    }
    lines.push('');
  }

  lines.push(`## Conversation`);
  lines.push('');

  for (const message of data.session.messages) {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

    switch (message.role) {
      case 'system':
        lines.push(`### System`);
        lines.push('```');
        lines.push(content);
        lines.push('```');
        lines.push('');
        break;

      case 'user':
        lines.push(`### User`);
        lines.push(content);
        lines.push('');
        break;

      case 'assistant':
        lines.push(`### Assistant`);
        if (message.toolCalls && message.toolCalls.length > 0) {
          for (const tc of message.toolCalls) {
            lines.push(`**Tool: ${tc.function.name}**`);
            lines.push('```');
            lines.push(typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments, null, 2));
            lines.push('```');
            lines.push('');
          }
          if (content.trim()) {
            lines.push(content);
            lines.push('');
          }
        } else {
          lines.push(content);
          lines.push('');
        }
        break;

      case 'tool':
        lines.push(`### Tool Result`);
        lines.push('```');
        lines.push(content);
        lines.push('```');
        lines.push('');
        break;
    }
  }

  return lines.join('\n');
}