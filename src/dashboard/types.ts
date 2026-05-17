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

export type TypedWSMessage =
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

export interface DashboardState {
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

export function upsertAgent(
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

// ── Client-to-Server message protocol ──

export type ClientMessage =
  | { type: 'chat_send'; sessionId: string; content: string }
  | { type: 'task_start'; prompt: string; model?: string; provider?: string }
  | { type: 'task_cancel'; sessionId: string }
  | { type: 'model_select'; provider: string; model: string }
  | { type: 'session_create' }
  | { type: 'session_list' }
  | { type: 'session_resume'; sessionId: string };

export type ServerAck =
  | { type: 'ack'; ok: boolean; error?: string }
  | { type: 'session_created'; sessionId: string }
  | { type: 'session_list_result'; sessions: Array<{ id: string; createdAt: number; updatedAt: number; messageCount: number }> }
  | { type: 'model_changed'; provider: string; model: string };

// ── REST API response types ──

export interface SessionListItem {
  id: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface SessionsResponse {
  sessions: SessionListItem[];
}

export interface SessionDetail {
  id: string;
  [key: string]: unknown;
}

export interface ModelsResponse {
  providers: string[];
}

export interface ToolDefinition {
  name: string;
  description?: string;
  [key: string]: unknown;
}

export interface ToolsResponse {
  tools: ToolDefinition[];
}

export interface PluginInfo {
  name: string;
  [key: string]: unknown;
}

export interface PluginsResponse {
  plugins: PluginInfo[];
}

export interface WorkflowSummary {
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  stepCount: number;
}

export interface WorkflowsResponse {
  workflows: WorkflowSummary[];
}

export interface WorkflowRunResult {
  runId: string;
  status: string;
  stepResults: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  timestamp: number;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface HealthSubsystemCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  detail?: string;
}

export interface HealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  version: string;
  checks: {
    provider?: HealthSubsystemCheck;
    memory?: HealthSubsystemCheck;
    sessions?: HealthSubsystemCheck;
    mcp?: HealthSubsystemCheck;
  };
  details: Record<string, unknown>;
}

export interface LivenessResult {
  alive: boolean;
  uptime: number;
}

export interface ReadinessResult {
  ready: boolean;
  checks: HealthResult['checks'];
}
