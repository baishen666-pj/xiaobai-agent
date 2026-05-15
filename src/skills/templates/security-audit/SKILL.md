---
name: security-audit
description: OWASP-focused security review of code and configuration
category: review
version: 1.0.0
author: xiaobai
---

# Security Audit

Perform a systematic security review using the OWASP Top 10 as a baseline.

## Audit Methodology

1. Scan the target for common vulnerability patterns
2. Check each OWASP Top 10 category
3. Review dependency and configuration security
4. Classify findings by severity
5. Provide remediation steps with code examples

## OWASP Top 10 Checklist

| Category | What to Check |
|----------|--------------|
| A01 - Broken Access Control | Missing auth checks, privilege escalation |
| A02 - Cryptographic Failures | Weak crypto, hardcoded keys, plaintext storage |
| A03 - Injection | SQL injection, XSS, command injection, path traversal |
| A04 - Insecure Design | Missing rate limiting, unsafe defaults |
| A05 - Security Misconfiguration | Debug mode, default credentials, verbose errors |
| A06 - Vulnerable Components | Outdated deps, known CVEs |
| A07 - Auth Failures | Weak passwords, missing MFA, session fixation |
| A08 - Data Integrity Failures | Untrusted deserialization, missing integrity checks |
| A09 - Logging Failures | Missing audit logs, sensitive data in logs |
| A10 - SSRF | Unvalidated URLs, internal network access |

## Finding Severity

| Level | CVSS Range | Action |
|-------|-----------|--------|
| CRITICAL | 9.0-10.0 | Immediate fix required |
| HIGH | 7.0-8.9 | Fix before next release |
| MEDIUM | 4.0-6.9 | Fix within sprint |
| LOW | 0.1-3.9 | Backlog |

## Output Format

```
[SEVERITY] OWASP-A0X — Vulnerability title
  File: path:line
  Description: What's wrong and why it matters
  Proof of Concept: How to exploit
  Remediation: Specific fix with code example
  References: OWASP link, CWE number
```

## Variables

- `{{target}}` — The code or configuration to audit
- `{{scope}}` — Audit scope (full, dependencies-only, auth-only, api-only)
