import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecurityAudit } from '../../src/security/audit.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('SecurityAudit', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = mkdtempSync(join(tmpdir(), 'xiaobai-audit-'));
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('generates a report with timestamp and summary', async () => {
    const audit = new SecurityAudit(auditDir);
    const report = await audit.runFull();

    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.findings).toBeInstanceOf(Array);
    expect(report.summary).toHaveProperty('critical');
    expect(report.summary).toHaveProperty('warn');
    expect(report.summary).toHaveProperty('info');
  });

  it('detects secrets in config files', async () => {
    writeFileSync(join(auditDir, 'config.json'), JSON.stringify({
      api_key: 'sk-1234567890abcdef1234567890abcdef1234567890abcdef',
    }));

    const audit = new SecurityAudit(auditDir);
    const report = await audit.runFull();

    const secretFinding = report.findings.find((f) => f.category === 'secrets');
    expect(secretFinding).toBeDefined();
    expect(secretFinding!.severity).toBe('critical');
  });

  it('reports info when no tool policy exists', async () => {
    const audit = new SecurityAudit(auditDir);
    const report = await audit.runFull();

    const toolFinding = report.findings.find((f) => f.category === 'tools');
    expect(toolFinding).toBeDefined();
    expect(toolFinding!.severity).toBe('info');
  });

  it('warns when no auth is configured', async () => {
    const originalToken = process.env.XIAOBAI_AUTH_TOKEN;
    const originalPassword = process.env.XIAOBAI_PASSWORD;
    delete process.env.XIAOBAI_AUTH_TOKEN;
    delete process.env.XIAOBAI_PASSWORD;

    const audit = new SecurityAudit(auditDir);
    const report = await audit.runFull();

    const authFinding = report.findings.find((f) => f.category === 'auth');
    expect(authFinding).toBeDefined();

    if (originalToken) process.env.XIAOBAI_AUTH_TOKEN = originalToken;
    if (originalPassword) process.env.XIAOBAI_PASSWORD = originalPassword;
  });

  it('warns about short auth tokens', async () => {
    const original = process.env.XIAOBAI_AUTH_TOKEN;
    process.env.XIAOBAI_AUTH_TOKEN = 'short';

    const audit = new SecurityAudit(auditDir);
    const report = await audit.runFull();

    const shortToken = report.findings.find((f) => f.message.includes('too short'));
    expect(shortToken).toBeDefined();
    expect(shortToken!.severity).toBe('warn');

    if (original) process.env.XIAOBAI_AUTH_TOKEN = original;
    else delete process.env.XIAOBAI_AUTH_TOKEN;
  });

  it('each finding has required fields', async () => {
    const audit = new SecurityAudit(auditDir);
    const report = await audit.runFull();

    for (const finding of report.findings) {
      expect(finding.id).toMatch(/^AUD-\d{3}$/);
      expect(['critical', 'warn', 'info']).toContain(finding.severity);
      expect(finding.category).toBeTruthy();
      expect(finding.message).toBeTruthy();
    }
  });

  it('summary counts match findings', async () => {
    const audit = new SecurityAudit(auditDir);
    const report = await audit.runFull();

    const critical = report.findings.filter((f) => f.severity === 'critical').length;
    const warn = report.findings.filter((f) => f.severity === 'warn').length;
    const info = report.findings.filter((f) => f.severity === 'info').length;

    expect(report.summary.critical).toBe(critical);
    expect(report.summary.warn).toBe(warn);
    expect(report.summary.info).toBe(info);
  });
});
