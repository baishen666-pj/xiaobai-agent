export type ACPMessageType =
  | 'initialize'
  | 'initialized'
  | 'task/start'
  | 'task/cancel'
  | 'task/message'
  | 'task/stream'
  | 'task/complete'
  | 'task/error'
  | 'permission/request'
  | 'permission/response'
  | 'shutdown';

export interface ACPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: ACPMessageType;
  params?: Record<string, unknown>;
}

export interface ACPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ACPAgentInfo {
  name: string;
  version: string;
  capabilities: {
    streaming: boolean;
    tools: string[];
    models: string[];
  };
}

export interface ACPTaskParams {
  prompt: string;
  model?: string;
  maxTurns?: number;
  workingDirectory?: string;
  tools?: string[];
}

export interface ACPTaskResult {
  output: string;
  success: boolean;
  tokensUsed?: number;
  toolCalls?: Array<{ name: string; result: string }>;
}

export interface ACPPermissionRequest {
  tool: string;
  args: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
  description: string;
}
