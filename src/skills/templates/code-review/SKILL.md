---
name: code-review
description: Systematic code review with severity-classified findings and actionable suggestions
category: review
version: 1.0.0
author: xiaobai
requires:
  bins:
    - git
---

# Code Review

Review the target code systematically, classifying each finding by severity.

## Methodology

1. Read all changed files or the specified target
2. Analyze each file for correctness, performance, security, readability, and error handling
3. Classify every finding by severity level
4. Provide specific, actionable suggestions with code examples

## Review Checklist

For each file, check:
- Correctness: Does the code do what it claims?
- Performance: N+1 queries, unbounded loops, unnecessary allocations?
- Security: Injection, XSS, path traversal, hardcoded secrets?
- Readability: Clear naming, reasonable function size (<50 lines)?
- Error handling: Errors handled explicitly, not silently swallowed?

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Security vulnerability or data loss risk | Must fix |
| HIGH | Bug or significant quality issue | Should fix |
| MEDIUM | Maintainability concern | Consider fixing |
| LOW | Style or minor suggestion | Optional |

## Output Format

For each finding, output:

```
[SEVERITY] file:line — description
  Suggestion: specific fix with code example
```

End with a summary table:

```
CRITICAL: 0 | HIGH: 1 | MEDIUM: 3 | LOW: 2
```

## Variables

- `{{target}}` — The code, diff, or file path to review
- `{{focus}}` — Optional: specific areas to focus on (e.g., "security", "performance")
