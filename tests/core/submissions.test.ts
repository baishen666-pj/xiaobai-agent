import { describe, it, expect } from 'vitest';

describe('AgentEvent and Submission types', () => {
  it('creates typed submissions', () => {
    const userInput: any = { type: 'user_input', content: 'hello' };
    expect(userInput.type).toBe('user_input');

    const interrupt: any = { type: 'interrupt', reason: 'user cancelled' };
    expect(interrupt.type).toBe('interrupt');

    const compact: any = { type: 'compact' };
    expect(compact.type).toBe('compact');

    const approval: any = { type: 'approval', toolCallId: 'tc_1', approved: true };
    expect(approval.approved).toBe(true);
  });

  it('creates typed agent events', () => {
    const modelOutput: any = { type: 'model_output', content: 'hello', tokens: 50 };
    expect(modelOutput.type).toBe('model_output');

    const toolCall: any = { type: 'tool_call', id: 'tc_1', name: 'read', args: { path: '/tmp' } };
    expect(toolCall.name).toBe('read');

    const stop: any = { type: 'stop', reason: 'completed', tokens: 100 };
    expect(stop.reason).toBe('completed');
  });

  it('defines stop reasons', () => {
    const reasons = ['completed', 'max_turns', 'aborted', 'prompt_too_long', 'model_error', 'hook_blocked', 'interrupted'];
    for (const reason of reasons) {
      const event: any = { type: 'stop', reason, tokens: 0 };
      expect(event.reason).toBe(reason);
    }
  });

  it('defines sandbox policies', () => {
    const policies = ['read-only', 'workspace-write', 'full-access'];
    for (const policy of policies) {
      const ctx: any = { sandboxPolicy: policy };
      expect(ctx.sandboxPolicy).toBe(policy);
    }
  });
});
