import React, { useCallback, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ChatPanel } from './chat-panel.js';
import { InputBar } from './input-bar.js';
import { StatusBar } from './status-bar.js';
import { useAgentChat } from './hooks.js';
import type { XiaobaiAgent } from '../../core/agent.js';
import type { TokenTracker } from '../../core/token-tracker.js';
import { TokenTracker as TokenTrackerImpl } from '../../core/token-tracker.js';
import { PricingTable } from '../../core/pricing.js';
import { formatTokenUsage, formatCost, formatTokenSummary } from '../renderer.js';

interface TuiAppProps {
  agent: XiaobaiAgent;
  model?: string;
  auto?: boolean;
}

function formatUsage(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function TuiApp({ agent, auto }: TuiAppProps) {
  const { exit } = useApp();
  const tokenTracker = useMemo(() => new TokenTrackerImpl(new PricingTable()), []);
  const { state, sendMessage, abort, clearSession } = useAgentChat(agent, tokenTracker);

  const handleCommand = useCallback((text: string) => {
    if (text.startsWith('/')) {
      handleSlashCommand(text, exit, clearSession, agent, tokenTracker, state);
      return;
    }
    sendMessage(text);
  }, [sendMessage, exit, clearSession, agent, tokenTracker, state]);

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      if (state.isProcessing) {
        abort();
      } else {
        exit();
      }
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1}>
        <ChatPanel
          messages={state.messages}
          isProcessing={state.isProcessing}
          statusText={state.statusText}
        />
        {state.lastError && (
          <Box marginLeft={2}>
            <Text color="red">Error: {state.lastError}</Text>
          </Box>
        )}
      </Box>
      <InputBar
        onSubmit={handleCommand}
        isProcessing={state.isProcessing}
        onAbort={abort}
      />
      <StatusBar
        agent={agent}
        tokenTracker={tokenTracker}
        turnCount={state.turnCount}
        totalTokens={state.totalTokens}
        isProcessing={state.isProcessing}
      />
    </Box>
  );
}

function handleSlashCommand(
  text: string,
  exit: () => void,
  clearSession: () => void,
  agent: XiaobaiAgent,
  tokenTracker: TokenTracker,
  state: { turnCount: number; totalTokens: number },
): void {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case '/exit':
    case '/quit':
      exit();
      break;

    case '/clear':
      clearSession();
      break;

    case '/help':
      console.log('\nCommands: /exit /clear /help /tools /model /metrics /health /sessions /memory\n');
      break;

    case '/tools': {
      const tools = agent.getTools().list();
      console.log(`\nTools (${tools.length}):`);
      tools.forEach((t: string) => console.log(`  - ${t}`));
      console.log();
      break;
    }

    case '/model': {
      if (parts.length === 1) {
        const current = agent.getCurrentModel();
        console.log(`Provider: ${current.provider}`);
        console.log(`Model:    ${current.model}\n`);
      } else if (parts.length === 2) {
        agent.setModel(parts[1]);
        const updated = agent.getCurrentModel();
        console.log(`Switched to provider: ${updated.provider}\n`);
      } else {
        agent.setModel(parts[1], parts[2]);
        console.log(`Switched to ${parts[1]}/${parts[2]}\n`);
      }
      break;
    }

    case '/metrics': {
      const summary = tokenTracker.getSummary();
      console.log(`\nTurns: ${state.turnCount}`);
      console.log(`Tokens: ${formatTokenUsage(summary.totalTokens || state.totalTokens)}`);
      if (summary.totalCost > 0) {
        console.log(`Cost: ${formatCost(summary.totalCost)}\n`);
      } else {
        console.log();
      }
      break;
    }

    case '/memory': {
      const usage = agent.getMemory().getUsage();
      console.log(`\nMemory: ${usage.memory.used}/${usage.memory.limit} chars`);
      console.log(`User:   ${usage.user.used}/${usage.user.limit} chars\n`);
      break;
    }

    default:
      console.log(`Unknown command: ${cmd}. Type /help for available commands.`);
  }
}
