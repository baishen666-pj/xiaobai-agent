import React from 'react';
import { Box, Text } from 'ink';
import type { ChatMessage } from './hooks.js';

interface ChatPanelProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  statusText: string;
  height?: number;
}

function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <Box marginBottom={0}>
      <Text color="green">{'>'}</Text>
      <Text> {msg.content}</Text>
    </Box>
  );
}

function AssistantMessage({ msg }: { msg: ChatMessage }) {
  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={0}>
      <Text>{msg.content || (msg.streaming ? '' : '')}</Text>
      {msg.streaming && <Text color="gray">...</Text>}
    </Box>
  );
}

function ToolMessage({ msg }: { msg: ChatMessage }) {
  const name = msg.toolName ?? 'unknown';
  const hasResult = msg.toolResult !== undefined;
  const success = msg.toolResult?.success ?? false;

  if (hasResult) {
    const icon = success ? '✓' : '✗';
    const color = success ? 'green' : 'red';
    const argSummary = getArgSummary(name, msg.toolArgs ?? {});
    return (
      <Box marginLeft={2}>
        <Text color={color}>{icon}</Text>
        <Text> </Text>
        <Text color="yellow">{name}</Text>
        <Text color="gray">({argSummary})</Text>
      </Box>
    );
  }

  return (
    <Box marginLeft={2}>
      <Text color="cyan">⟳</Text>
      <Text> </Text>
      <Text color="yellow">{name}</Text>
      <Text color="gray">({getArgSummary(name, msg.toolArgs ?? {})})</Text>
    </Box>
  );
}

function getArgSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'bash': return truncate(String(args['command'] ?? ''), 50);
    case 'read': return truncate(String(args['file_path'] ?? ''), 50);
    case 'write': return `${truncate(String(args['file_path'] ?? ''), 40)} (${String(args['content'] ?? '').split('\n').length} lines)`;
    case 'edit': return truncate(String(args['file_path'] ?? ''), 50);
    case 'grep': return truncate(String(args['pattern'] ?? ''), 40);
    case 'glob': return truncate(String(args['pattern'] ?? ''), 40);
    default: return Object.keys(args).slice(0, 2).join(', ');
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

export function ChatPanel({ messages, isProcessing, statusText, height }: ChatPanelProps) {
  const visibleMessages = messages.slice(-(height ?? 50));

  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      {visibleMessages.map((msg) => {
        switch (msg.role) {
          case 'user':
            return <UserMessage key={msg.id} msg={msg} />;
          case 'assistant':
            return <AssistantMessage key={msg.id} msg={msg} />;
          case 'tool':
            return <ToolMessage key={msg.id} msg={msg} />;
          default:
            return null;
        }
      })}
      {isProcessing && statusText && (
        <Box marginLeft={2}>
          <Text color="cyan">{'⠋'}</Text>
          <Text color="gray"> {statusText}</Text>
        </Box>
      )}
    </Box>
  );
}
