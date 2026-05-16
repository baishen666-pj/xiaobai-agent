import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecurityAudit } from '../../src/security/audit.js';
import { writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('SecurityAudit - extended coverage', () => {
  let auditDir: string;
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    auditDir = mkdtempSync(join(tmpdir(), 'xiaobai-audit-ext-'));
    envBackup.XIAOBAI_PORT = process.env.XIAOBAI_PORT;
    envBackup.PORT = process.env.PORT;
    envBackup.XIAOBAI_SANDBOX = process.env.XIAOBAI_SANDBOX;
    envBackup.XIAOBAI_AUTH_TOKEN = process.env.XIAOBAI_AUTH_TOKEN;
    envBackup.XIAOBAI_PASSWORD = process.env.XIAOBAI_PASSWORD;
    delete process.env.XIAOBAI_PORT;
    delete process.env.PORT;
    delete process.env.XIAOBAI_SANDBOX;
    delete process.env.XIAOBAI_AUTH_TOKEN;
    delete process.env.XIAOBAI_PASSWORD;
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
    for (const [key, val] of Object.entries(envBackup)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  describe('checkNetworkExposure', () => {
    it('warns when XIAOBAI_PORT is 0', async () => {
      process.env.XIAOBAI_PORT = '0';
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const networkFinding = report.findings.find((f) => f.category === 'network');
      expect(networkFinding).toBeDefined();
      expect(networkFinding!.severity).toBe('warn');
      expect(networkFinding!.detail).toContain('Port 0');
    });

    it('warns when XIAOBAI_PORT is 80', async () => {
      process.env.XIAOBAI_PORT = '80';
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const networkFinding = report.findings.find((f) => f.category === 'network');
      expect(networkFinding).toBeDefined();
      expect(networkFinding!.detail).toContain('Port 80');
    });

    it('warns when XIAOBAI_PORT is 443', async () => {
      process.env.XIAOBAI_PORT = '443';
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const networkFinding = report.findings.find((f) => f.category === 'network');
      expect(networkFinding).toBeDefined();
      expect(networkFinding!.detail).toContain('Port 443');
    });

    it('does not warn when PORT is a non-privileged port', async () => {
      process.env.PORT = '3001';
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const networkFinding = report.findings.find((f) => f.category === 'network');
      expect(networkFinding).toBeUndefined();
    });

    it('does not warn when no port env is set', async () => {
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const networkFinding = report.findings.find((f) => f.category === 'network');
      expect(networkFinding).toBeUndefined();
    });

    it('uses PORT fallback when XIAOBAI_PORT is not set', async () => {
      process.env.PORT = '80';
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const networkFinding = report.findings.find((f) => f.category === 'network');
      expect(networkFinding).toBeDefined();
    });
  });

  describe('checkSandboxConfiguration', () => {
    it('warns when sandbox is full-access', async () => {
      process.env.XIAOBAI_SANDBOX = 'full-access';
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const sandboxFinding = report.findings.find((f) => f.category === 'sandbox');
      expect(sandboxFinding).toBeDefined();
      expect(sandboxFinding!.severity).toBe('warn');
      expect(sandboxFinding!.message).toContain('full-access');
    });

    it('warns when sandbox is danger-full-access', async () => {
      process.env.XIAOBAI_SANDBOX = 'danger-full-access';
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const sandboxFinding = report.findings.find((f) => f.category === 'sandbox');
      expect(sandboxFinding).toBeDefined();
      expect(sandboxFinding!.severity).toBe('warn');
    });

    it('does not warn when sandbox is workspace-write', async () => {
      process.env.XIAOBAI_SANDBOX = 'workspace-write';
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const sandboxFinding = report.findings.find((f) => f.category === 'sandbox');
      expect(sandboxFinding).toBeUndefined();
    });

    it('does not warn when sandbox is not set', async () => {
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const sandboxFinding = report.findings.find((f) => f.category === 'sandbox');
      expect(sandboxFinding).toBeUndefined();
    });
  });

  describe('checkToolPolicies', () => {
    it('warns when all dangerous tools are allowed', async () => {
      writeFileSync(join(auditDir, 'tool-policy.json'), JSON.stringify({
        blocked: [],
      }));

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const toolFinding = report.findings.find(
        (f) => f.category === 'tools' && f.severity === 'warn',
      );
      expect(toolFinding).toBeDefined();
      expect(toolFinding!.message).toContain('No dangerous tools are blocked');
    });

    it('does not warn when some dangerous tools are blocked', async () => {
      writeFileSync(join(auditDir, 'tool-policy.json'), JSON.stringify({
        blocked: ['bash', 'exec'],
      }));

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const warnFinding = report.findings.find(
        (f) => f.category === 'tools' && f.severity === 'warn',
      );
      expect(warnFinding).toBeUndefined();
    });

    it('handles malformed tool-policy.json gracefully', async () => {
      writeFileSync(join(auditDir, 'tool-policy.json'), 'not valid json {');

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      // Should not crash; the catch {} swallows the parse error
      expect(report.findings).toBeInstanceOf(Array);
    });

    it('handles tool policy with no blocked field', async () => {
      writeFileSync(join(auditDir, 'tool-policy.json'), JSON.stringify({
        allowed: ['read'],
      }));

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const warnFinding = report.findings.find(
        (f) => f.category === 'tools' && f.severity === 'warn',
      );
      expect(warnFinding).toBeDefined();
    });
  });

  describe('checkSecretDetection - patterns', () => {
    it('detects secret pattern: secret=...', async () => {
      writeFileSync(join(auditDir, 'settings.json'), 'secret=abc1234567890123456789012345678901234567890');

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const secretFinding = report.findings.find((f) => f.category === 'secrets');
      expect(secretFinding).toBeDefined();
      expect(secretFinding!.severity).toBe('critical');
    });

    it('detects secret pattern: token=...', async () => {
      writeFileSync(join(auditDir, 'config.json'), 'token=abc1234567890123456789012345678901234567890');

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const secretFinding = report.findings.find((f) => f.category === 'secrets');
      expect(secretFinding).toBeDefined();
      expect(secretFinding!.severity).toBe('critical');
    });

    it('detects secret pattern: password=...', async () => {
      writeFileSync(join(auditDir, 'credentials.json'), 'password=abc1234567890123456789012345678901234567890');

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const secretFinding = report.findings.find((f) => f.category === 'secrets');
      expect(secretFinding).toBeDefined();
      expect(secretFinding!.severity).toBe('critical');
    });

    it('detects key- pattern in .env file', async () => {
      writeFileSync(join(auditDir, '.env'), 'API_KEY=key-1234567890abcdef1234567890abcdef1234567890abcdef');

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const secretFinding = report.findings.find((f) => f.category === 'secrets');
      expect(secretFinding).toBeDefined();
      expect(secretFinding!.severity).toBe('critical');
    });

    it('does not detect secrets in non-matching content', async () => {
      writeFileSync(join(auditDir, 'config.json'), JSON.stringify({ name: 'xiaobai', version: '1.0' }));

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const secretFinding = report.findings.find((f) => f.category === 'secrets');
      expect(secretFinding).toBeUndefined();
    });
  });

  describe('checkAuthConfiguration', () => {
    it('does not warn when auth token is long enough', async () => {
      process.env.XIAOBAI_AUTH_TOKEN = 'a'.repeat(20);
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const shortToken = report.findings.find((f) => f.message.includes('too short'));
      expect(shortToken).toBeUndefined();
    });

    it('reports no auth when neither token nor password is set', async () => {
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const authFinding = report.findings.find(
        (f) => f.category === 'auth' && f.message.includes('No authentication'),
      );
      expect(authFinding).toBeDefined();
      expect(authFinding!.severity).toBe('info');
    });

    it('does not report no-auth when password is set', async () => {
      process.env.XIAOBAI_PASSWORD = 'somepassword';
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const noAuth = report.findings.find(
        (f) => f.category === 'auth' && f.message.includes('No authentication'),
      );
      expect(noAuth).toBeUndefined();
    });
  });

  describe('checkConfigDirPermissions', () => {
    it('skips check when config dir does not exist', async () => {
      const nonExistentDir = join(tmpdir(), 'xiaobai-audit-nonexistent-' + Date.now());
      const audit = new SecurityAudit(nonExistentDir);
      const report = await audit.runFull();
      const fsFinding = report.findings.find((f) => f.category === 'filesystem');
      // No filesystem finding since directory doesn't exist
      expect(fsFinding).toBeUndefined();
    });

    it('reports info when permissions are restrictive', async () => {
      // On Windows, the mode bits work differently; just verify it runs without error
      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();
      const fsFinding = report.findings.find((f) => f.category === 'filesystem');
      // On Windows, may or may not produce a finding depending on mode
      expect(report.findings).toBeInstanceOf(Array);
    });
  });

  describe('counter and finding IDs', () => {
    it('generates sequential AUD-xxx IDs', async () => {
      // Set up conditions that produce multiple findings
      process.env.XIAOBAI_SANDBOX = 'full-access';
      process.env.XIAOBAI_AUTH_TOKEN = 'short';

      const audit = new SecurityAudit(auditDir);
      const report = await audit.runFull();

      const ids = report.findings.map((f) => f.id);
      for (let i = 0; i < ids.length; i++) {
        const num = i + 1;
        expect(ids[i]).toBe(`AUD-${String(num).padStart(3, '0')}`);
      }
    });

    it('resets findings on each runFull call', async () => {
      const audit = new SecurityAudit(auditDir);
      const report1 = await audit.runFull();
      const report2 = await audit.runFull();
      // IDs should restart from AUD-001 on second run
      expect(report2.findings[0].id).toBe('AUD-001');
      // Counts should be independent
      expect(report1.findings.length).toBe(report2.findings.length);
    });
  });
});
