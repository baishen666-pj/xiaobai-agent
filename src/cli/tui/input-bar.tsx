import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface InputBarProps {
  onSubmit: (text: string) => void;
  isProcessing: boolean;
  onAbort?: () => void;
}

const SLASH_COMMANDS = ['/exit', '/quit', '/clear', '/help', '/tools', '/model', '/metrics', '/health', '/sessions', '/memory', '/compact', '/export'];

export function InputBar({ onSubmit, isProcessing, onAbort }: InputBarProps) {
  const [input, setInput] = useState('');
  const [suggestion, setSuggestion] = useState('');

  const handleChange = useCallback((value: string) => {
    setInput(value);
    if (value.startsWith('/') && !value.includes(' ')) {
      const match = SLASH_COMMANDS.find((c) => c.startsWith(value) && c !== value);
      setSuggestion(match ? match.slice(value.length) : '');
    } else {
      setSuggestion('');
    }
  }, []);

  const handleSubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setInput('');
    setSuggestion('');
    onSubmit(trimmed);
  }, [onSubmit]);

  useInput((_input, key) => {
    if (key.escape && isProcessing) {
      onAbort?.();
    }
  });

  return (
    <Box>
      <Text color="green" bold>{'>'} </Text>
      {isProcessing ? (
        <Text color="gray">Processing... (Esc to cancel)</Text>
      ) : (
        <Box>
          <TextInput
            value={input}
            onChange={handleChange}
            onSubmit={handleSubmit}
            placeholder="Type a message or /help for commands..."
            showCursor={true}
          />
          {suggestion && <Text color="gray">{suggestion}</Text>}
        </Box>
      )}
    </Box>
  );
}
