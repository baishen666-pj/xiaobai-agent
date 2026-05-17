import { describe, it, expect } from 'vitest';
import { isClientMessage } from '../../src/server/client-messages.js';

describe('isClientMessage', () => {
  it('accepts chat_send', () => {
    expect(isClientMessage({ type: 'chat_send', sessionId: 's1', content: 'hello' })).toBe(true);
  });

  it('accepts task_start', () => {
    expect(isClientMessage({ type: 'task_start', prompt: 'do stuff' })).toBe(true);
  });

  it('accepts task_start with optional fields', () => {
    expect(isClientMessage({ type: 'task_start', prompt: 'do stuff', model: 'gpt-4', provider: 'openai' })).toBe(true);
  });

  it('accepts task_cancel', () => {
    expect(isClientMessage({ type: 'task_cancel', sessionId: 's1' })).toBe(true);
  });

  it('accepts model_select', () => {
    expect(isClientMessage({ type: 'model_select', provider: 'anthropic', model: 'claude-3' })).toBe(true);
  });

  it('accepts session_create', () => {
    expect(isClientMessage({ type: 'session_create' })).toBe(true);
  });

  it('accepts session_list', () => {
    expect(isClientMessage({ type: 'session_list' })).toBe(true);
  });

  it('accepts session_resume', () => {
    expect(isClientMessage({ type: 'session_resume', sessionId: 's1' })).toBe(true);
  });

  it('rejects null', () => {
    expect(isClientMessage(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isClientMessage('hello')).toBe(false);
    expect(isClientMessage(42)).toBe(false);
  });

  it('rejects unknown type', () => {
    expect(isClientMessage({ type: 'unknown' })).toBe(false);
  });

  it('rejects missing type', () => {
    expect(isClientMessage({ content: 'hello' })).toBe(false);
  });
});
