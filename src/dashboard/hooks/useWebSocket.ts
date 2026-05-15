import { useEffect, useRef, useState, useCallback } from 'react';

export interface AgentInfo {
  id: string;
  role: string;
  busy: boolean;
  currentTask?: string;
}

export interface TaskInfo {
  id: string;
  description: string;
  role: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  tokensUsed?: number;
}

export interface LogEvent {
  type: string;
  timestamp: number;
  message: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error';
  content: string;
  toolName?: string;
  success?: boolean;
  tokens?: number;
  timestamp: number;
}

export interface OrchestratorWSMessage {
  type: string;
  [key: string]: unknown;
}

interface DashboardState {
  connected: boolean;
  events: LogEvent[];
  agents: AgentInfo[];
  tasks: TaskInfo[];
  tokenTotal: number;
  chatMessages: ChatMessage[];
  chatTokenTotal: number;
  eventFilter: string;
}

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<DashboardState>({
    connected: false,
    events: [],
    agents: [],
    tasks: [],
    tokenTotal: 0,
    chatMessages: [],
    chatTokenTotal: 0,
    eventFilter: 'all',
  });

  const addEvent = useCallback((type: string, message: string) => {
    setState((prev) => ({
      ...prev,
      events: [...prev.events.slice(-199), { type, timestamp: Date.now(), message }],
    }));
  }, []);

  const setEventFilter = useCallback((filter: string) => {
    setState((prev) => ({ ...prev, eventFilter: filter }));
  }, []);

  const handleMessage = useCallback(
    (data: OrchestratorWSMessage) => {
      switch (data.type) {
        case 'plan':
          setState((prev) => {
            const tasks = (data.tasks as any[]).map((t) => ({
              id: t.id,
              description: t.description,
              role: t.role,
              status: t.status,
            }));
            return { ...prev, tasks };
          });
          addEvent('plan', `Plan created with ${(data.tasks as any[]).length} tasks`);
          break;

        case 'task_started':
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === (data.task as any)?.id
                ? { ...t, status: 'running', startedAt: Date.now() }
                : t,
            ),
            agents: upsertAgent(prev.agents, data.agentId as string, (data.task as any)?.role ?? 'unknown', true, (data.task as any)?.id),
          }));
          addEvent('task_started', `Task started: ${(data.task as any)?.description?.slice(0, 60)}`);
          break;

        case 'task_progress':
          break;

        case 'task_completed':
          setState((prev) => {
            const result = data.result as any;
            const tokens = result?.tokensUsed ?? 0;
            return {
              ...prev,
              tasks: prev.tasks.map((t) =>
                t.id === (data.task as any)?.id
                  ? { ...t, status: 'completed', completedAt: Date.now(), tokensUsed: tokens }
                  : t,
              ),
              tokenTotal: prev.tokenTotal + tokens,
              agents: prev.agents.map((a) =>
                a.currentTask === (data.task as any)?.id ? { ...a, busy: false, currentTask: undefined } : a
              ),
            };
          });
          addEvent('task_completed', `Task completed: ${(data.task as any)?.description?.slice(0, 60)}`);
          break;

        case 'task_failed':
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === (data.task as any)?.id
                ? { ...t, status: 'failed', completedAt: Date.now() }
                : t,
            ),
            agents: prev.agents.map((a) =>
              a.currentTask === (data.task as any)?.id ? { ...a, busy: false, currentTask: undefined } : a
            ),
          }));
          addEvent('task_failed', `Task failed: ${data.error}`);
          break;

        case 'all_completed':
          addEvent('all_completed', `All tasks completed`);
          break;

        case 'agent_status':
          setState((prev) => ({
            ...prev,
            agents: data.agents as AgentInfo[],
          }));
          break;

        // Chat events
        case 'chat_start':
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `start_${Date.now()}`,
              sessionId: data.sessionId as string,
              type: 'user' as const,
              content: (data.prompt as string)?.slice(0, 200),
              timestamp: data.timestamp as number,
            }],
          }));
          addEvent('chat_start', `Chat started: ${(data.prompt as string)?.slice(0, 60)}`);
          break;

        case 'chat_turn':
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `turn_${Date.now()}_${prev.chatMessages.length}`,
              sessionId: data.sessionId as string,
              type: 'assistant' as const,
              content: (data.content as string)?.slice(0, 500),
              tokens: data.tokens as number,
              timestamp: Date.now(),
            }],
            chatTokenTotal: prev.chatTokenTotal + (data.tokens as number ?? 0),
          }));
          break;

        case 'chat_tool_call':
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `tc_${Date.now()}_${prev.chatMessages.length}`,
              sessionId: data.sessionId as string,
              type: 'tool_call' as const,
              content: '',
              toolName: data.toolName as string,
              timestamp: Date.now(),
            }],
          }));
          addEvent('chat_tool_call', `Tool: ${data.toolName}`);
          break;

        case 'chat_tool_result':
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `tr_${Date.now()}_${prev.chatMessages.length}`,
              sessionId: data.sessionId as string,
              type: 'tool_result' as const,
              content: (data.output as string)?.slice(0, 200),
              toolName: data.toolName as string,
              success: data.success as boolean,
              timestamp: Date.now(),
            }],
          }));
          break;

        case 'chat_stop':
          addEvent('chat_stop', `Chat stopped: ${data.reason}`);
          break;

        case 'chat_error':
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `err_${Date.now()}`,
              sessionId: data.sessionId as string,
              type: 'error' as const,
              content: data.error as string,
              timestamp: Date.now(),
            }],
          }));
          addEvent('chat_error', `Error: ${data.error}`);
          break;
      }
    },
    [addEvent],
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setState((prev) => ({ ...prev, connected: true }));
      addEvent('connected', `Connected to ${url}`);
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as OrchestratorWSMessage;
        handleMessage(data);
      } catch {}
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
      addEvent('disconnected', 'Connection closed');
    };

    ws.onerror = () => {
      addEvent('error', 'Connection error');
    };

    wsRef.current = ws;
  }, [url, handleMessage, addEvent]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    setEventFilter,
  };
}

function upsertAgent(
  agents: AgentInfo[],
  id: string,
  role: string,
  busy: boolean,
  currentTask?: string,
): AgentInfo[] {
  const idx = agents.findIndex((a) => a.id === id);
  if (idx >= 0) {
    const updated = [...agents];
    updated[idx] = { ...updated[idx], busy, currentTask };
    return updated;
  }
  return [...agents, { id, role, busy, currentTask }];
}
