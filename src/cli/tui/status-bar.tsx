import React from 'react';
import { Box, Text } from 'ink';
import type { TokenTracker } from '../../core/token-tracker.js';
import type { XiaobaiAgent } from '../../core/agent.js';

interface StatusBarProps {
  agent: XiaobaiAgent;
  tokenTracker: TokenTracker;
  turnCount: number;
  totalTokens: number;
  isProcessing: boolean;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function StatusBar({ agent, tokenTracker, turnCount, totalTokens, isProcessing }: StatusBarProps) {
  const model = agent.getCurrentModel();
  const summary = tokenTracker.getSummary();

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexGrow={1}>
        <Text color="cyan">{model.provider}</Text>
        <Text color="gray">/</Text>
        <Text color="cyan">{model.model}</Text>
      </Box>
      <Box>
        <Text color="gray">Turn:</Text>
        <Text> {turnCount}</Text>
        <Text color="gray"> | Tokens:</Text>
        <Text> {formatTokens(summary.totalTokens || totalTokens)}</Text>
        {summary.totalCost > 0 && (
          <>
            <Text color="gray"> | Cost:</Text>
            <Text> {formatCost(summary.totalCost)}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
