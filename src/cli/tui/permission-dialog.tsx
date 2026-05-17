import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export interface PermissionRequest {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  hasDiff: boolean;
}

interface PermissionDialogProps {
  request: PermissionRequest | null;
  onDecision: (allowed: boolean, always?: boolean) => void;
}

export function PermissionDialog({ request, onDecision }: PermissionDialogProps) {
  const [showDiff, setShowDiff] = useState(false);

  useInput(useCallback((_input: string, key: { return?: boolean; escape?: boolean; leftArrow?: boolean; rightArrow?: boolean; upArrow?: boolean; downArrow?: boolean; delete?: boolean; backspace?: boolean; pageUp?: boolean; pageDown?: boolean; tab?: boolean }) => {
    if (!request) return;

    if (key.return) return;

    const ch = _input.toLowerCase();
    if (ch === 'y') onDecision(true);
    else if (ch === 'n') onDecision(false);
    else if (ch === 'a') onDecision(true, true);
    else if (ch === 'd' && request.hasDiff) setShowDiff(true);
  }, [request, onDecision]));

  if (!request) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>Permission required:</Text>
      <Box>
        <Text color="yellow">{request.tool}</Text>
        <Text color="gray"> {request.summary}</Text>
      </Box>
      <Text color="gray">[y] Allow  [n] Deny  [a] Always{request.hasDiff ? '  [d] Show diff' : ''}</Text>
    </Box>
  );
}
