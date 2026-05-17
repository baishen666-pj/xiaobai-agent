import { useState, useCallback, useRef } from 'react';
import type { XiaobaiAgent } from '../../core/agent.js';
import type { LoopEvent } from '../../core/loop.js';
import type { TokenTracker } from '../../core/token-tracker.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: { success: boolean; output: string };
  tokens?: number;
  timestamp: number;
  streaming?: boolean;
}

export interface SessionState {
  sessionId: string;
  turnCount: number;
  totalTokens: number;
  messages: ChatMessage[];
  isProcessing: boolean;
  statusText: string;
  lastError: string | null;
}

let messageIdCounter = 0;
function nextId(): string {
  return `msg_${++messageIdCounter}_${Date.now()}`;
}

export function useAgentChat(agent: XiaobaiAgent, tokenTracker: TokenTracker) {
  const [state, setState] = useState<SessionState>(() => ({
    sessionId: agent.getDeps().sessions.createSession(),
    turnCount: 0,
    totalTokens: 0,
    messages: [],
    isProcessing: false,
    statusText: '',
    lastError: null,
  }));

  const stateRef = useRef(state);
  stateRef.current = state;

  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (stateRef.current.isProcessing) return;

    const userMsg: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const streamMsgId = nextId();
    const streamMsg: ChatMessage = {
      id: streamMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    };

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMsg, streamMsg],
      isProcessing: true,
      statusText: 'Thinking...',
      lastError: null,
      turnCount: prev.turnCount + 1,
    }));

    const abort = new AbortController();
    abortRef.current = abort;

    let currentToolName = '';
    let currentToolArgs: Record<string, unknown> = {};
    const streamParts: string[] = [];

    try {
      for await (const event of agent.chat(text, stateRef.current.sessionId, {
        stream: true,
        abortSignal: abort.signal,
        tokenTracker,
      })) {
        processEvent(event, streamParts, streamMsgId, currentToolName, currentToolArgs, setState, tokenTracker);
        if (event.type === 'tool_call') {
          currentToolName = event.toolName ?? '';
          currentToolArgs = event.toolArgs ?? {};
        }
        if (event.type === 'tool_result') {
          currentToolName = '';
          currentToolArgs = {};
        }
      }

      setState((prev) => ({
        ...prev,
        isProcessing: false,
        statusText: '',
        messages: prev.messages.map((m) =>
          m.id === streamMsgId ? { ...m, streaming: false, content: streamParts.join('') } : m,
        ),
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        statusText: '',
        lastError: (error as Error).message,
        messages: prev.messages.map((m) =>
          m.id === streamMsgId ? { ...m, streaming: false, content: streamParts.join('') || 'Error occurred' } : m,
        ),
      }));
    }

    abortRef.current = null;
  }, [agent, tokenTracker]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isProcessing: false, statusText: '' }));
  }, []);

  const clearSession = useCallback(() => {
    setState((prev) => ({
      ...prev,
      sessionId: agent.getDeps().sessions.createSession(),
      turnCount: 0,
      totalTokens: 0,
      messages: [],
      lastError: null,
    }));
  }, [agent]);

  return { state, sendMessage, abort, clearSession };
}

function processEvent(
  event: LoopEvent,
  streamParts: string[],
  streamMsgId: string,
  currentToolName: string,
  currentToolArgs: Record<string, unknown>,
  setState: React.Dispatch<React.SetStateAction<SessionState>>,
  tokenTracker: TokenTracker,
): void {
  switch (event.type) {
    case 'text':
      streamParts.push(event.content);
      setState((prev) => ({
        ...prev,
        statusText: '',
        messages: prev.messages.map((m) =>
          m.id === streamMsgId ? { ...m, content: streamParts.join('') } : m,
        ),
      }));
      break;

    case 'stream':
      streamParts.push(event.content);
      setState((prev) => ({
        ...prev,
        statusText: '',
        messages: prev.messages.map((m) =>
          m.id === streamMsgId ? { ...m, content: streamParts.join('') } : m,
        ),
      }));
      break;

    case 'tool_call':
      setState((prev) => ({
        ...prev,
        statusText: `Running ${event.toolName}...`,
        messages: [
          ...prev.messages,
          {
            id: nextId(),
            role: 'tool',
            content: '',
            toolName: event.toolName,
            toolArgs: event.toolArgs,
            timestamp: Date.now(),
          },
        ],
      }));
      break;

    case 'tool_result': {
      const toolMsg: ChatMessage = {
        id: nextId(),
        role: 'tool',
        content: event.content,
        toolName: event.toolName ?? (currentToolName || 'unknown'),
        toolArgs: currentToolArgs,
        toolResult: event.result ? { success: event.result.success, output: event.result.output } : undefined,
        timestamp: Date.now(),
      };
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, toolMsg],
      }));
      break;
    }

    case 'compact':
      setState((prev) => ({ ...prev, statusText: 'Compressing context...' }));
      break;

    case 'stop':
      if (event.tokens) {
        setState((prev) => ({ ...prev, totalTokens: prev.totalTokens + event.tokens! }));
      }
      break;

    case 'error':
      setState((prev) => ({ ...prev, lastError: event.content }));
      break;
  }
}

export type { LoopEvent };
