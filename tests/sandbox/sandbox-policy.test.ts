import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SandboxManager, type SandboxMode } from '../../src/sandbox/manager.js';

function createManager(mode: SandboxMode) {
  return new SandboxManager({ mode });
}

describe('SandboxManager', () => {
  it('reports correct mode', () => {
    expect(createManager('read-only').getMode()).toBe('read-only');
    expect(createManager('workspace-write').getMode()).toBe('workspace-write');
    expect(createManager('full-access').getMode()).toBe('full-access');
  });

  it('read-only mode blocks writes', () => {
    const mgr = createManager('read-only');
    expect(mgr.isReadOnly()).toBe(true);
    expect(mgr.canWrite('/tmp/test', '/tmp')).toBe(false);
  });

  it('workspace-write mode allows writes within cwd', () => {
    const mgr = createManager('workspace-write');
    expect(mgr.canWrite('/project/src/file.ts', '/project')).toBe(true);
    expect(mgr.canWrite('/etc/passwd', '/project')).toBe(false);
  });

  it('full-access mode allows everything', () => {
    const mgr = createManager('full-access');
    expect(mgr.canWrite('/etc/passwd', '/project')).toBe(true);
    expect(mgr.canExecute('sudo rm -rf /')).toBe(true);
  });

  it('blocks dangerous commands in workspace-write mode', () => {
    const mgr = createManager('workspace-write');
    expect(mgr.canExecute('ls')).toBe(true);
    expect(mgr.canExecute('rm -rf /')).toBe(false);
    expect(mgr.canExecute('sudo')).toBe(false);
  });
});

describe('Per-session tool policies', () => {
  it('allows all tools by default', () => {
    const mgr = createManager('workspace-write');
    expect(mgr.isToolAllowed('read')).toBe(true);
    expect(mgr.isToolAllowed('bash')).toBe(true);
  });

  it('blocks tools per session', () => {
    const mgr = createManager('workspace-write');
    mgr.setSessionPolicy('sess_1', { blockedTools: new Set(['bash', 'write']) });

    expect(mgr.isToolAllowed('read', 'sess_1')).toBe(true);
    expect(mgr.isToolAllowed('bash', 'sess_1')).toBe(false);
    expect(mgr.isToolAllowed('write', 'sess_1')).toBe(false);
  });

  it('allows only listed tools per session', () => {
    const mgr = createManager('workspace-write');
    mgr.setSessionPolicy('sess_2', { allowedTools: new Set(['read', 'grep', 'glob']) });

    expect(mgr.isToolAllowed('read', 'sess_2')).toBe(true);
    expect(mgr.isToolAllowed('bash', 'sess_2')).toBe(false);
  });

  it('clears session policy', () => {
    const mgr = createManager('workspace-write');
    mgr.setSessionPolicy('sess_3', { blockedTools: new Set(['bash']) });
    expect(mgr.isToolAllowed('bash', 'sess_3')).toBe(false);

    mgr.clearSessionPolicy('sess_3');
    expect(mgr.isToolAllowed('bash', 'sess_3')).toBe(true);
  });

  it('session policy does not affect other sessions', () => {
    const mgr = createManager('workspace-write');
    mgr.setSessionPolicy('sess_a', { blockedTools: new Set(['bash']) });

    expect(mgr.isToolAllowed('bash', 'sess_a')).toBe(false);
    expect(mgr.isToolAllowed('bash', 'sess_b')).toBe(true);
  });
});

describe('Network access control', () => {
  it('defaults to allow-all', () => {
    const mgr = new SandboxManager({ mode: 'workspace-write' });
    expect(mgr.canAccessNetwork('example.com')).toBe(true);
  });

  it('blocks all in deny-all mode', () => {
    const mgr = new SandboxManager({ mode: 'workspace-write', network: 'deny-all' });
    expect(mgr.canAccessNetwork('example.com')).toBe(false);
  });

  it('allows only listed domains', () => {
    const mgr = new SandboxManager({
      mode: 'workspace-write',
      network: 'allow-list',
      allowedDomains: ['api.example.com', 'cdn.example.com'],
    });
    expect(mgr.canAccessNetwork('api.example.com')).toBe(true);
    expect(mgr.canAccessNetwork('evil.com')).toBe(false);
  });
});
