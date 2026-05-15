import { describe, it, expect } from 'vitest';
import { PermissionPrompt } from '../../src/cli/permissions.js';

describe('PermissionPrompt', () => {
  it('auto-allows read tools', async () => {
    const prompt = new PermissionPrompt('default');
    expect(await prompt.checkPermission('read', { file_path: '/tmp/test.txt' })).toBe(true);
  });

  it('auto-allows grep tool', async () => {
    const prompt = new PermissionPrompt('default');
    expect(await prompt.checkPermission('grep', { pattern: 'test' })).toBe(true);
  });

  it('auto-allows glob tool', async () => {
    const prompt = new PermissionPrompt('default');
    expect(await prompt.checkPermission('glob', { pattern: '**/*.ts' })).toBe(true);
  });

  it('auto mode allows everything', async () => {
    const prompt = new PermissionPrompt('auto');
    expect(await prompt.checkPermission('bash', { command: 'rm -rf /' })).toBe(true);
    expect(await prompt.checkPermission('write', { file_path: '/etc/passwd', content: 'hack' })).toBe(true);
  });

  it('plan mode only allows read tools', async () => {
    const prompt = new PermissionPrompt('plan');
    expect(await prompt.checkPermission('read', { file_path: '/tmp' })).toBe(true);
    expect(await prompt.checkPermission('write', { file_path: '/tmp' })).toBe(false);
    expect(await prompt.checkPermission('bash', { command: 'ls' })).toBe(false);
  });

  it('accept-edits allows read and write tools', async () => {
    const prompt = new PermissionPrompt('accept-edits');
    expect(await prompt.checkPermission('read', { file_path: '/tmp' })).toBe(true);
    expect(await prompt.checkPermission('write', { file_path: '/tmp', content: 'x' })).toBe(true);
    expect(await prompt.checkPermission('edit', { file_path: '/tmp' })).toBe(true);
  });

  it('caches always-allow rules', async () => {
    const prompt = new PermissionPrompt('default');
    // Simulate adding a rule
    (prompt as any).rules.push({ tool: 'bash', decision: 'always' });
    expect(await prompt.checkPermission('bash', { command: 'echo test' })).toBe(true);
  });
});
