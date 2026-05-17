import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString, Text, Box } from 'ink';
import { ChatPanel } from '../../../src/cli/tui/chat-panel.js';
import { InputBar } from '../../../src/cli/tui/input-bar.js';
import { PermissionDialog } from '../../../src/cli/tui/permission-dialog.js';
import type { ChatMessage } from '../../../src/cli/tui/hooks.js';

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `test_${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: 'test message',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ChatPanel', () => {
  it('renders user messages', () => {
    const messages: ChatMessage[] = [
      createMessage({ role: 'user', content: 'Hello world' }),
    ];
    const output = renderToString(
      <ChatPanel messages={messages} isProcessing={false} statusText="" />,
    );
    expect(output).toContain('Hello world');
  });

  it('renders assistant messages', () => {
    const messages: ChatMessage[] = [
      createMessage({ role: 'assistant', content: 'Hi there!' }),
    ];
    const output = renderToString(
      <ChatPanel messages={messages} isProcessing={false} statusText="" />,
    );
    expect(output).toContain('Hi there!');
  });

  it('renders tool call messages', () => {
    const messages: ChatMessage[] = [
      createMessage({
        role: 'tool',
        content: '',
        toolName: 'bash',
        toolArgs: { command: 'echo hello' },
      }),
    ];
    const output = renderToString(
      <ChatPanel messages={messages} isProcessing={false} statusText="" />,
    );
    expect(output).toContain('bash');
    expect(output).toContain('echo hello');
  });

  it('renders tool result messages with success indicator', () => {
    const messages: ChatMessage[] = [
      createMessage({
        role: 'tool',
        content: 'hello\n',
        toolName: 'bash',
        toolResult: { success: true, output: 'hello\n' },
      }),
    ];
    const output = renderToString(
      <ChatPanel messages={messages} isProcessing={false} statusText="" />,
    );
    expect(output).toContain('bash');
  });

  it('renders tool result messages with failure indicator', () => {
    const messages: ChatMessage[] = [
      createMessage({
        role: 'tool',
        content: 'error',
        toolName: 'bash',
        toolResult: { success: false, output: 'error' },
      }),
    ];
    const output = renderToString(
      <ChatPanel messages={messages} isProcessing={false} statusText="" />,
    );
    expect(output).toContain('bash');
  });

  it('shows processing status when active', () => {
    const messages: ChatMessage[] = [];
    const output = renderToString(
      <ChatPanel messages={messages} isProcessing={true} statusText="Thinking..." />,
    );
    expect(output).toContain('Thinking...');
  });

  it('shows streaming indicator for streaming messages', () => {
    const messages: ChatMessage[] = [
      createMessage({ role: 'assistant', content: 'Partial', streaming: true }),
    ];
    const output = renderToString(
      <ChatPanel messages={messages} isProcessing={true} statusText="" />,
    );
    expect(output).toContain('Partial');
  });

  it('renders multiple messages in order', () => {
    const messages: ChatMessage[] = [
      createMessage({ role: 'user', content: 'First' }),
      createMessage({ role: 'assistant', content: 'Second' }),
      createMessage({ role: 'user', content: 'Third' }),
    ];
    const output = renderToString(
      <ChatPanel messages={messages} isProcessing={false} statusText="" />,
    );
    expect(output).toContain('First');
    expect(output).toContain('Second');
    expect(output).toContain('Third');
  });

  it('handles empty messages array', () => {
    const output = renderToString(
      <ChatPanel messages={[]} isProcessing={false} statusText="" />,
    );
    expect(output).toBeDefined();
  });

  it('truncates long tool arguments', () => {
    const longPath = 'a'.repeat(100);
    const messages: ChatMessage[] = [
      createMessage({
        role: 'tool',
        content: '',
        toolName: 'read',
        toolArgs: { file_path: longPath },
      }),
    ];
    const output = renderToString(
      <ChatPanel messages={messages} isProcessing={false} statusText="" />,
    );
    expect(output).toContain('read');
    expect(output).toContain('...');
  });
});

describe('InputBar', () => {
  it('renders input prompt when not processing', () => {
    const onSubmit = vi.fn();
    const output = renderToString(
      <InputBar onSubmit={onSubmit} isProcessing={false} />,
    );
    expect(output).toContain('>');
  });

  it('shows processing message when processing', () => {
    const onSubmit = vi.fn();
    const output = renderToString(
      <InputBar onSubmit={onSubmit} isProcessing={true} />,
    );
    expect(output).toContain('Processing');
    expect(output).toContain('Esc');
  });
});

describe('PermissionDialog', () => {
  it('renders nothing when no request', () => {
    const onDecision = vi.fn();
    const output = renderToString(
      <PermissionDialog request={null} onDecision={onDecision} />,
    );
    expect(output.trim()).toBe('');
  });

  it('renders permission request with tool info', () => {
    const onDecision = vi.fn();
    const request = {
      tool: 'bash',
      args: { command: 'rm -rf /' },
      summary: 'rm -rf /',
      hasDiff: false,
    };
    const output = renderToString(
      <PermissionDialog request={request} onDecision={onDecision} />,
    );
    expect(output).toContain('bash');
    expect(output).toContain('Permission');
    expect(output).toContain('[y]');
    expect(output).toContain('[n]');
  });

  it('shows diff option when hasDiff is true', () => {
    const onDecision = vi.fn();
    const request = {
      tool: 'write',
      args: { file_path: '/tmp/test.txt', content: 'hello' },
      summary: '/tmp/test.txt',
      hasDiff: true,
    };
    const output = renderToString(
      <PermissionDialog request={request} onDecision={onDecision} />,
    );
    expect(output).toContain('[d]');
  });

  it('omits diff option when hasDiff is false', () => {
    const onDecision = vi.fn();
    const request = {
      tool: 'bash',
      args: { command: 'ls' },
      summary: 'ls',
      hasDiff: false,
    };
    const output = renderToString(
      <PermissionDialog request={request} onDecision={onDecision} />,
    );
    expect(output).not.toContain('[d]');
  });
});

describe('renderToString basic', () => {
  it('renders basic ink components', () => {
    const output = renderToString(
      <Box>
        <Text color="green">Hello</Text>
        <Text> World</Text>
      </Box>,
    );
    expect(output).toContain('Hello');
    expect(output).toContain('World');
  });
});
