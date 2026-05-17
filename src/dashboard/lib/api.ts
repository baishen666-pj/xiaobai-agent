import type {
  SessionsResponse,
  SessionDetail,
  ModelsResponse,
  ToolsResponse,
  PluginsResponse,
  WorkflowsResponse,
  WorkflowRunResult,
  ChatResponse,
  HealthResult,
  LivenessResult,
  ReadinessResult,
  ApiError,
} from '../types.js';

export type { ApiError };

export function createApiClient(basePath = '') {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(basePath + path, init);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw body as ApiError;
    }
    return res.json() as Promise<T>;
  }

  return {
    listSessions(signal?: AbortSignal) {
      return request<SessionsResponse>('/api/sessions', { signal });
    },

    getSession(id: string, signal?: AbortSignal) {
      return request<{ session: SessionDetail }>(`/api/sessions/${encodeURIComponent(id)}`, { signal });
    },

    deleteSession(id: string, signal?: AbortSignal) {
      return request<{ deleted: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        signal,
      });
    },

    getModels(signal?: AbortSignal) {
      return request<ModelsResponse>('/api/models', { signal });
    },

    getTools(signal?: AbortSignal) {
      return request<ToolsResponse>('/api/tools', { signal });
    },

    getPlugins(signal?: AbortSignal) {
      return request<PluginsResponse>('/api/plugins', { signal });
    },

    listWorkflows(signal?: AbortSignal) {
      return request<WorkflowsResponse>('/api/workflows', { signal });
    },

    runWorkflow(name: string, variables?: Record<string, string>, signal?: AbortSignal) {
      return request<WorkflowRunResult>(`/api/workflows/${encodeURIComponent(name)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables ? { variables } : {}),
        signal,
      });
    },

    chat(message: string, options?: { sessionId?: string; model?: string }, signal?: AbortSignal) {
      return request<ChatResponse>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, ...options }),
        signal,
      });
    },

    health(signal?: AbortSignal) {
      return request<HealthResult>('/health', { signal });
    },

    liveness(signal?: AbortSignal) {
      return request<LivenessResult>('/health/live', { signal });
    },

    readiness(signal?: AbortSignal) {
      return request<ReadinessResult>('/health/ready', { signal });
    },
  };
}

export const api = createApiClient();
