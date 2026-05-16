import { useEffect, useRef, useState, useCallback } from 'react';

export interface AgentInfo {
  id: string;
  role: string;
  busy: boolean;
  currentTask?: string;
  cost?: number;
}

export interface TaskInfo {
  id: string;
  description: string;
  role: string;
  status: string;
  priority?: string;
  startedAt?: number;
  completedAt?: number;
  tokensUsed?: number;
  retries?: number;
  maxRetries?: number;
  dependencies?: string[];
  parentTaskId?: string;
}

export interface TokenHistoryEntry {
  timestamp: number;
  tokens: number;
  taskId: string;
  role: string;
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

// ── Typed WebSocket event data ──

export interface OrchestratorWSMessage {
  type: string;
  [key: string]: unknown;
}

export interface WSTaskInfo {
  id?: string;
  description?: string;
  role?: string;
  status?: string;
  priority?: string;
  retries?: number;
  maxRetries?: number;
  dependencies?: string[];
  parentTaskId?: string;
}

export interface WSAgentInfo {
  id: string;
  role: string;
  busy: boolean;
  currentTask?: string;
  cost?: number;
}

interface PlanEventData extends OrchestratorWSMessage {
  type: 'plan';
  tasks: WSTaskInfo[];
}

interface TaskStartedEventData extends OrchestratorWSMessage {
  type: 'task_started';
  task: WSTaskInfo;
  agentId: string;
}

interface TaskProgressEventData extends OrchestratorWSMessage {
  type: 'task_progress';
  task: WSTaskInfo;
  event: { content?: string; [key: string]: unknown };
}

interface TaskCompletedEventData extends OrchestratorWSMessage {
  type: 'task_completed';
  task: WSTaskInfo;
  result: { tokensUsed?: number; [key: string]: unknown };
}

interface TaskFailedEventData extends OrchestratorWSMessage {
  type: 'task_failed';
  task: WSTaskInfo;
  error: string;
}

interface AgentStatusEventData extends OrchestratorWSMessage {
  type: 'agent_status';
  agents: WSAgentInfo[];
}

interface ChatStartEventData extends OrchestratorWSMessage {
  type: 'chat_start';
  sessionId: string;
  prompt: string;
  timestamp: number;
}

interface ChatTurnEventData extends OrchestratorWSMessage {
  type: 'chat_turn';
  sessionId: string;
  content: string;
  tokens: number;
}

interface ChatToolCallEventData extends OrchestratorWSMessage {
  type: 'chat_tool_call';
  sessionId: string;
  toolName: string;
}

interface ChatToolResultEventData extends OrchestratorWSMessage {
  type: 'chat_tool_result';
  sessionId: string;
  toolName: string;
  output: string;
  success: boolean;
}

interface ChatStopEventData extends OrchestratorWSMessage {
  type: 'chat_stop';
  reason: string;
}

interface ChatErrorEventData extends OrchestratorWSMessage {
  type: 'chat_error';
  sessionId: string;
  error: string;
}

type TypedWSMessage =
  | PlanEventData
  | TaskStartedEventData
  | TaskProgressEventData
  | TaskCompletedEventData
  | TaskFailedEventData
  | AgentStatusEventData
  | ChatStartEventData
  | ChatTurnEventData
  | ChatToolCallEventData
  | ChatToolResultEventData
  | ChatStopEventData
  | ChatErrorEventData
  | OrchestratorWSMessage;

interface DashboardState {
  connected: boolean;
  events: LogEvent[];
  agents: AgentInfo[];
  tasks: TaskInfo[];
  tokenTotal: number;
  chatMessages: ChatMessage[];
  chatTokenTotal: number;
  eventFilter: string;
  tokenHistory: TokenHistoryEntry[];
  progressEvents: Record<string, string[]>;
}

const MAX_RECONNECT_DELAY = 30_000;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const urlRef = useRef(url);
  const idCounterRef = useRef(0);

  const [state, setState] = useState<DashboardState>({
    connected: false,
    events: [],
    agents: [],
    tasks: [],
    tokenTotal: 0,
    chatMessages: [],
    chatTokenTotal: 0,
    eventFilter: 'all',
    tokenHistory: [],
    progressEvents: {},
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
    (data: TypedWSMessage) => {
      switch (data.type) {
        case 'plan': {
          const planData = data as PlanEventData;
          const tasks = planData.tasks.map((t) => ({
            id: t.id ?? '',
            description: t.description ?? '',
            role: t.role ?? '',
            status: t.status ?? 'pending',
            priority: t.priority,
            retries: t.retries,
            maxRetries: t.maxRetries,
            dependencies: t.dependencies,
            parentTaskId: t.parentTaskId,
          }));
          setState((prev) => ({ ...prev, tasks }));
          addEvent('plan', `Plan created with ${planData.tasks.length} tasks`);
          break;
        }

        case 'task_started': {
          const startedData = data as TaskStartedEventData;
          const startedTask = startedData.task;
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === startedTask?.id
                ? { ...t, status: 'running', startedAt: Date.now() }
                : t,
            ),
            agents: upsertAgent(prev.agents, startedData.agentId as string, startedTask?.role ?? 'unknown', true, startedTask?.id),
          }));
          addEvent('task_started', `Task started: ${startedTask?.description?.slice(0, 60) ?? ''}`);
          break;
        }

        case 'task_progress': {
          const progressData = data as TaskProgressEventData;
          const taskId = progressData.task?.id;
          const progressMsg = progressData.event?.content?.slice(0, 200);
          if (taskId && progressMsg) {
            setState((prev) => ({
              ...prev,
              progressEvents: {
                ...prev.progressEvents,
                [taskId]: [...(prev.progressEvents[taskId] || []).slice(-49), progressMsg],
              },
            }));
            addEvent('task_progress', `${taskId}: ${progressMsg.slice(0, 60)}`);
          }
          break;
        }

        case 'task_completed': {
          const completedData = data as TaskCompletedEventData;
          const completedResult = completedData.result;
          const tokens = completedResult?.tokensUsed ?? 0;
          const completedTask = completedData.task;
          const role = completedTask?.role ?? 'unknown';
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === completedTask?.id
                ? { ...t, status: 'completed', completedAt: Date.now(), tokensUsed: tokens }
                : t,
            ),
            tokenTotal: prev.tokenTotal + tokens,
            tokenHistory: [...prev.tokenHistory.slice(-199), { timestamp: Date.now(), tokens, taskId: completedTask?.id ?? '', role }],
            agents: prev.agents.map((a) =>
              a.currentTask === completedTask?.id ? { ...a, busy: false, currentTask: undefined } : a
            ),
          }));
          addEvent('task_completed', `Task completed: ${completedTask?.description?.slice(0, 60) ?? ''}`);
          break;
        }

        case 'task_failed': {
          const failedData = data as TaskFailedEventData;
          const failedTask = failedData.task;
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === failedTask?.id
                ? { ...t, status: 'failed', completedAt: Date.now() }
                : t,
            ),
            agents: prev.agents.map((a) =>
              a.currentTask === failedTask?.id ? { ...a, busy: false, currentTask: undefined } : a
            ),
          }));
          addEvent('task_failed', `Task failed: ${failedData.error}`);
          break;
        }

        case 'all_completed':
          addEvent('all_completed', `All tasks completed`);
          break;

        case 'agent_status': {
          const agentData = data as AgentStatusEventData;
          setState((prev) => ({
            ...prev,
            agents: agentData.agents.map((a) => ({
              id: a.id,
              role: a.role,
              busy: a.busy,
              currentTask: a.currentTask,
              cost: a.cost,
            })),
          }));
          break;
        }

        // Chat events
        case 'chat_start': {
          const chatStartData = data as ChatStartEventData;
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `start_${Date.now()}_${++idCounterRef.current}`,
              sessionId: chatStartData.sessionId,
              type: 'user' as const,
              content: chatStartData.prompt?.slice(0, 200) ?? '',
              timestamp: chatStartData.timestamp,
            }],
          }));
          addEvent('chat_start', `Chat started: ${chatStartData.prompt?.slice(0, 60) ?? ''}`);
          break;
        }

        case 'chat_turn': {
          const chatTurnData = data as ChatTurnEventData;
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `turn_${Date.now()}_${++idCounterRef.current}`,
              sessionId: chatTurnData.sessionId,
              type: 'assistant' as const,
              content: chatTurnData.content?.slice(0, 500) ?? '',
              tokens: chatTurnData.tokens,
              timestamp: Date.now(),
            }],
            chatTokenTotal: prev.chatTokenTotal + (chatTurnData.tokens ?? 0),
          }));
          break;
        }

        case 'chat_tool_call': {
          const toolCallData = data as ChatToolCallEventData;
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `tc_${Date.now()}_${++idCounterRef.current}`,
              sessionId: toolCallData.sessionId,
              type: 'tool_call' as const,
              content: '',
              toolName: toolCallData.toolName,
              timestamp: Date.now(),
            }],
          }));
          addEvent('chat_tool_call', `Tool: ${toolCallData.toolName}`);
          break;
        }

        case 'chat_tool_result': {
          const toolResultData = data as ChatToolResultEventData;
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `tr_${Date.now()}_${++idCounterRef.current}`,
              sessionId: toolResultData.sessionId,
              type: 'tool_result' as const,
              content: toolResultData.output?.slice(0, 200) ?? '',
              toolName: toolResultData.toolName,
              success: toolResultData.success,
              timestamp: Date.now(),
            }],
          }));
          break;
        }

        case 'chat_stop':
          addEvent('chat_stop', `Chat stopped: ${(data as ChatStopEventData).reason}`);
          break;

        case 'chat_error': {
          const chatErrorData = data as ChatErrorEventData;
          setState((prev) => ({
            ...prev,
            chatMessages: [...prev.chatMessages.slice(-99), {
              id: `err_${Date.now()}_${++idCounterRef.current}`,
              sessionId: chatErrorData.sessionId,
              type: 'error' as const,
              content: chatErrorData.error,
              timestamp: Date.now(),
            }],
          }));
          addEvent('chat_error', `Error: ${chatErrorData.error}`);
          break;
        }
      }
    },
    [addEvent],
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    shouldReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    urlRef.current = url;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      addEvent('error', `Invalid WebSocket URL: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    ws.onopen = () => {
      setState((prev) => ({ ...prev, connected: true }));
      reconnectAttemptsRef.current = 0;
      addEvent('connected', `Connected to ${url}`);
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as TypedWSMessage;
        handleMessage(data);
      } catch (err) {
        addEvent('error', `Invalid message: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
      addEvent('disconnected', 'Connection closed');

      if (shouldReconnectRef.current) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), MAX_RECONNECT_DELAY);
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          if (shouldReconnectRef.current) {
            connect();
          }
        }, delay);
      }
    };

    ws.onerror = () => {
      addEvent('error', 'Connection error');
    };

    wsRef.current = ws;
  }, [url, handleMessage, addEvent]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
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