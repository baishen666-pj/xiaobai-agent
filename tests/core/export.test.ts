import { describe, it, expect } from 'vitest';
import { exportToJson, exportToMarkdown, type ExportData } from '../../src/core/export.js';
import type { Message } from '../../src/session/manager.js';
import type { TokenUsageSummary } from '../../src/core/token-tracker.js';

const baseMessages: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
  { role: 'assistant', content: 'Hi there! How can I help?' },
];

const baseExportData: ExportData = {
  version: '0.4.0',
  exportedAt: '2026-05-16T12:00:00.000Z',
  session: {
    id: 'session_test_123',
    messages: baseMessages,
    turnCount: 1,
    startedAt: '2026-05-16T11:59:00.000Z',
    completedAt: '2026-05-16T12:00:00.000Z',
  },
};

describe('exportToJson', () => {
  it('should produce valid JSON', () => {
    const json = exportToJson(baseExportData);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe('0.4.0');
    expect(parsed.session.id).toBe('session_test_123');
    expect(parsed.session.messages.length).toBe(3);
  });

  it('should include token usage when provided', () => {
    const tokenUsage: TokenUsageSummary = {
      totalPromptTokens: 1000,
      totalCompletionTokens: 500,
      totalTokens: 1500,
      totalCost: 0.015,
      byProvider: new Map(),
      byModel: new Map([['anthropic/claude-sonnet-4-6', { tokens: 1500, cost: 0.015 }]]),
    };

    const data: ExportData = { ...baseExportData, tokenUsage };
    const json = exportToJson(data);
    const parsed = JSON.parse(json);
    expect(parsed.tokenUsage).toBeDefined();
    expect(parsed.tokenUsage.totalTokens).toBe(1500);
    expect(parsed.tokenUsage.totalCost).toBe(0.015);
  });

  it('should include metrics when provided', () => {
    const metrics = {
      timestamp: Date.now(),
      uptime: 60000,
      counters: { requests: 5 },
      gauges: { memory: 512 },
      histograms: {},
      custom: {},
    };

    const data: ExportData = { ...baseExportData, metrics };
    const json = exportToJson(data);
    const parsed = JSON.parse(json);
    expect(parsed.metrics).toBeDefined();
    expect(parsed.metrics.counters.requests).toBe(5);
  });

  it('should handle empty messages', () => {
    const data: ExportData = {
      ...baseExportData,
      session: { ...baseExportData.session, messages: [] },
    };
    const json = exportToJson(data);
    const parsed = JSON.parse(json);
    expect(parsed.session.messages).toEqual([]);
  });

  it('should serialize tool calls in messages', () => {
    const messagesWithTools: Message[] = [
      { role: 'user', content: 'Read a file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'tc_1',
          name: 'read',
          arguments: { file_path: '/test.ts' },
        }],
      },
    ];

    const data: ExportData = {
      ...baseExportData,
      session: { ...baseExportData.session, messages: messagesWithTools },
    };
    const json = exportToJson(data);
    const parsed = JSON.parse(json);
    expect(parsed.session.messages[1].toolCalls).toBeDefined();
    expect(parsed.session.messages[1].toolCalls[0].name).toBe('read');
  });
});

describe('exportToMarkdown', () => {
  it('should produce markdown with headers', () => {
    const md = exportToMarkdown(baseExportData);
    expect(md).toContain('# Session Export');
    expect(md).toContain('session_test_123');
    expect(md).toContain('2026-05-16T12:00:00.000Z');
  });

  it('should include conversation section', () => {
    const md = exportToMarkdown(baseExportData);
    expect(md).toContain('## Conversation');
    expect(md).toContain('### User');
    expect(md).toContain('Hello!');
    expect(md).toContain('### Assistant');
    expect(md).toContain('Hi there!');
  });

  it('should include system messages', () => {
    const md = exportToMarkdown(baseExportData);
    expect(md).toContain('### System');
    expect(md).toContain('helpful assistant');
  });

  it('should include token usage table', () => {
    const tokenUsage: TokenUsageSummary = {
      totalPromptTokens: 1000,
      totalCompletionTokens: 500,
      totalTokens: 1500,
      totalCost: 0.015,
      byProvider: new Map(),
      byModel: new Map([['anthropic/claude-sonnet-4-6', { tokens: 1500, cost: 0.015 }]]),
    };

    const data: ExportData = { ...baseExportData, tokenUsage };
    const md = exportToMarkdown(data);
    expect(md).toContain('## Token Usage');
    expect(md).toContain('1,500');
    expect(md).toContain('$0.0150');
    expect(md).toContain('anthropic/claude-sonnet-4-6');
  });

  it('should include metrics section', () => {
    const metrics = {
      timestamp: Date.now(),
      uptime: 60000,
      counters: { requests: 5 },
      gauges: {},
      histograms: {},
      custom: {},
    };

    const data: ExportData = { ...baseExportData, metrics };
    const md = exportToMarkdown(data);
    expect(md).toContain('## Metrics');
    expect(md).toContain('requests: 5');
  });

  it('should handle tool calls in markdown', () => {
    const messagesWithTools: Message[] = [
      { role: 'user', content: 'Read file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'tc_1',
          name: 'read',
          arguments: { file_path: '/test.ts' },
        }],
      },
    ];

    const data: ExportData = {
      ...baseExportData,
      session: { ...baseExportData.session, messages: messagesWithTools },
    };
    const md = exportToMarkdown(data);
    expect(md).toContain('**Tool: read**');
  });

  it('should handle empty messages', () => {
    const data: ExportData = {
      ...baseExportData,
      session: { ...baseExportData.session, messages: [] },
    };
    const md = exportToMarkdown(data);
    expect(md).toContain('## Conversation');
  });
});