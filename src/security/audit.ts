import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type AuditSeverity = 'critical' | 'warn' | 'info';

export interface AuditFinding {
  id: string;
  severity: AuditSeverity;
  category: string;
  message: string;
  detail?: string;
  remediation?: string;
}

export interface AuditReport {
  timestamp: number;
  findings: AuditFinding[];
  summary: { critical: number; warn: number; info: number };
}

export class SecurityAudit {
  private configDir: string;
  private findings: AuditFinding[] = [];
  private counter = 0;

  constructor(configDir: string) {
    this.configDir = configDir;
  }

  async runFull(): Promise<AuditReport> {
    this.findings = [];
    this.counter = 0;

    this.checkConfigDirPermissions();
    this.checkSecretDetection();
    this.checkNetworkExposure();
    this.checkSandboxConfiguration();
    this.checkToolPolicies();
    this.checkAuthConfiguration();

    return this.buildReport();
  }

  private addFinding(
    severity: AuditSeverity,
    category: string,
    message: string,
    detail?: string,
    remediation?: string,
  ): void {
    this.findings.push({
      id: `AUD-${String(++this.counter).padStart(3, '0')}`,
      severity,
      category,
      message,
      detail,
      remediation,
    });
  }

  private checkConfigDirPermissions(): void {
    const configDir = this.configDir;
    if (!existsSync(configDir)) return;

    try {
      const stat = statSync(configDir);
      const mode = stat.mode & 0o777;
      if (mode & 0o007) {
        this.addFinding(
          'critical',
          'filesystem',
          'Config directory is world-accessible',
          `Directory ${configDir} has mode ${mode.toString(8)}`,
          'Run: chmod 700 <config-dir>',
        );
      } else {
        this.addFinding('info', 'filesystem', 'Config directory permissions are restrictive');
      }
    } catch {}
  }

  private checkSecretDetection(): void {
    const configFiles = ['config.json', 'settings.json', 'credentials.json', '.env'];
    const secretPatterns = [
      /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[a-zA-Z0-9]{20,}/i,
      /(?:secret|token|password)\s*[:=]\s*['"]?[a-zA-Z0-9]{20,}/i,
      /sk-[a-zA-Z0-9]{40,}/,
      /key-[a-zA-Z0-9]{40,}/,
    ];

    for (const file of configFiles) {
      const path = join(this.configDir, file);
      if (!existsSync(path)) continue;

      try {
        const content = readFileSync(path, 'utf-8');
        for (const pattern of secretPatterns) {
          if (pattern.test(content)) {
            this.addFinding(
              'critical',
              'secrets',
              `Potential secret found in ${file}`,
              `Pattern ${pattern.source} matched in ${path}`,
              'Move secrets to environment variables or a secret manager',
            );
            break;
          }
        }
      } catch {}
    }
  }

  private checkNetworkExposure(): void {
    const envPort = process.env.XIAOBAI_PORT ?? process.env.PORT;
    if (envPort) {
      const port = parseInt(envPort, 10);
      if (port === 0 || port === 80 || port === 443) {
        this.addFinding(
          'warn',
          'network',
          'Server binding to privileged or well-known port',
          `Port ${port} may expose the dashboard to unintended access`,
          'Use a non-privileged port (e.g., 3001) or bind to 127.0.0.1',
        );
      }
    }
  }

  private checkSandboxConfiguration(): void {
    const envSandbox = process.env.XIAOBAI_SANDBOX;
    if (envSandbox === 'full-access' || envSandbox === 'danger-full-access') {
      this.addFinding(
        'warn',
        'sandbox',
        'Sandbox is in full-access mode',
        'Agent has unrestricted file and command access',
        'Use "workspace-write" or "read-only" for safer operation',
      );
    }
  }

  private checkToolPolicies(): void {
    const policyFile = join(this.configDir, 'tool-policy.json');
    if (existsSync(policyFile)) {
      try {
        const policy = JSON.parse(readFileSync(policyFile, 'utf-8'));
        const blocked = policy.blocked ?? [];
        const dangerous = ['bash', 'exec', 'shell', 'eval'];
        const notBlocked = dangerous.filter((t) => !blocked.includes(t));
        if (notBlocked.length > 0 && notBlocked.length === dangerous.length) {
          this.addFinding(
            'warn',
            'tools',
            'No dangerous tools are blocked',
            `Tools ${dangerous.join(', ')} are all allowed`,
            'Consider blocking shell execution tools in production',
          );
        }
      } catch {}
    } else {
      this.addFinding(
        'info',
        'tools',
        'No tool policy file found',
        undefined,
        'Create tool-policy.json with allowed/blocked tool lists',
      );
    }
  }

  private checkAuthConfiguration(): void {
    const hasAuthToken = process.env.XIAOBAI_AUTH_TOKEN;
    const hasPassword = process.env.XIAOBAI_PASSWORD;

    if (!hasAuthToken && !hasPassword) {
      this.addFinding(
        'info',
        'auth',
        'No authentication configured for dashboard',
        'Anyone who can reach the dashboard port has full access',
        'Set XIAOBAI_AUTH_TOKEN environment variable',
      );
    }

    if (hasAuthToken) {
      const token = hasAuthToken;
      if (token.length < 16) {
        this.addFinding(
          'warn',
          'auth',
          'Auth token is too short',
          `Token is ${token.length} characters, minimum recommended is 16`,
          'Generate a longer token: openssl rand -hex 32',
        );
      }
    }
  }

  private buildReport(): AuditReport {
    const critical = this.findings.filter((f) => f.severity === 'critical').length;
    const warn = this.findings.filter((f) => f.severity === 'warn').length;
    const info = this.findings.filter((f) => f.severity === 'info').length;

    return {
      timestamp: Date.now(),
      findings: this.findings,
      summary: { critical, warn, info },
    };
  }
}
