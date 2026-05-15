---
name: debug
description: Systematic debugging with root cause analysis using 5 Whys methodology
category: coding
version: 1.0.0
author: xiaobai
---

# Debug

Systematically debug the issue and identify the root cause.

## Debug Methodology

1. **Reproduce**: Confirm the issue is reproducible with a minimal test case
2. **Isolate**: Narrow down the scope — which module, function, or code path
3. **Hypothesize**: Form a specific hypothesis about the root cause
4. **Test**: Verify or refute the hypothesis with targeted checks
5. **Fix**: Implement the minimal fix
6. **Verify**: Confirm the fix resolves the issue without side effects

## Root Cause Analysis: 5 Whys

For each bug, ask "Why?" five times to reach the root cause:

```
Symptom: The API returns 500 on large payloads
Why? → JSON.stringify fails on circular references
Why? → The response object includes a back-reference to the request
Why? → The serializer doesn't strip internal fields
Why? → No serialization layer exists between model and API
Why? → The API was built without a response DTO layer
Root Cause: Missing response DTO layer
```

## Investigation Techniques

- **Bisect**: Use git bisect to find the commit that introduced the bug
- **Logging**: Add strategic log points to trace data flow
- **State Inspection**: Check variable values at each step
- **Diff Analysis**: Compare working vs broken state

## Output Format

```
## Bug Report
- Symptom: [description]
- Reproduction: [steps]
- Environment: [relevant context]

## Root Cause Analysis
1. [Why #1]
2. [Why #2]
3. [Why #3]
4. [Why #4]
5. [Root Cause]

## Fix
[Code change with explanation]

## Prevention
[Suggestion to prevent recurrence]
```

## Variables

- `{{error_description}}` — Description of the error or unexpected behavior
- `{{context}}` — Relevant context (stack trace, error logs, environment info)
