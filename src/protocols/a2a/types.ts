export enum TaskState {
  SUBMITTED = 'submitted',
  WORKING = 'working',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELED = 'canceled',
  REJECTED = 'rejected',
  INPUT_REQUIRED = 'input_required',
  AUTH_REQUIRED = 'auth_required',
}

export enum Role {
  USER = 'user',
  AGENT = 'agent',
}

export interface Part {
  text?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
}

export interface A2AMessage {
  messageId: string;
  role: Role;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatus {
  state: TaskState;
  message?: A2AMessage;
  timestamp?: string;
}

export interface A2ATask {
  id: string;
  contextId?: string;
  status: TaskStatus;
  artifacts?: Array<{ artifactId: string; parts: Part[] }>;
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  provider?: { url: string; organization: string };
  documentationUrl?: string;
  iconUrl?: string;
}

export interface SendMessageRequest {
  message: A2AMessage;
  configuration?: {
    acceptedOutputModes?: string[];
    historyLength?: number;
    contextId?: string;
  };
}

export type SendMessageResponse =
  | { task: A2ATask }
  | { message: A2AMessage };

export const A2AMethod = {
  SEND_MESSAGE: 'message/send',
  SEND_STREAMING_MESSAGE: 'message/stream',
  GET_TASK: 'tasks/get',
  LIST_TASKS: 'tasks/list',
  CANCEL_TASK: 'tasks/cancel',
  GET_AGENT_CARD: '.well-known/agent-card.json',
} as const;

export interface A2AJsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: string | number;
}

export interface A2AJsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: string | number | null;
}
