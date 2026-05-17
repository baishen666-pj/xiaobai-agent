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

const CLIENT_MESSAGE_TYPES = new Set<string>([
  'chat_send', 'task_start', 'task_cancel', 'model_select',
  'session_create', 'session_list', 'session_resume',
]);

export function isClientMessage(value: unknown): value is ClientMessage {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === 'string' && CLIENT_MESSAGE_TYPES.has(obj.type);
}
