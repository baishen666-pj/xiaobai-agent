---
name: perf-audit
description: Performance profiling and optimization with bottleneck identification and measurable improvements
category: analysis
version: 1.0.0
author: xiaobai
---

# Performance Audit

Systematically identify and resolve performance bottlenecks in the target code.

## Methodology

1. **Profile**: Identify hot paths and resource usage patterns
2. **Measure**: Establish baseline metrics before changes
3. **Analyze**: Determine root cause of each bottleneck
4. **Optimize**: Apply targeted fixes incrementally
5. **Verify**: Measure improvement after each change

## Checklist

### Algorithmic
- [ ] Time complexity acceptable for expected input size?
- [ ] Unnecessary O(n²) that could be O(n) or O(n log n)?
- [ ] Repeated computation that could be memoized?
- [ ] Nested loops that could be flattened?

### Memory
- [ ] Unnecessary allocations in hot paths?
- [ ] Large objects held longer than needed?
- [ ] Buffer pooling opportunities?
- [ ] Memory leaks from unclosed resources?

### I/O
- [ ] N+1 query patterns?
- [ ] Missing pagination on large result sets?
- [ ] Sequential I/O that could be parallel?
- [ ] Missing or ineffective caching?

### Network
- [ ] Unnecessary API round trips?
- [ ] Payload size optimization (compression, field selection)?
- [ ] Connection reuse and keep-alive?
- [ ] Retry/backoff strategy?

## Output Format

```
## Baseline
| Metric | Before | Target |
|--------|--------|--------|
| [metric] | [value] | [value] |

## Findings

[SEVERITY] file:line — description
  Impact: estimated improvement
  Fix: specific change with code example
  Risk: potential side effects

## Optimization Plan
1. [Change 1] — Expected: [improvement]
2. [Change 2] — Expected: [improvement]

## Results
| Metric | Before | After | Change |
|--------|--------|-------|--------|
```

## Variables

- `{{target}}` — The code or system to profile
- `{{focus}}` — Area to focus on (algorithmic, memory, io, network, all)
- `{{baseline}}` — Optional: current performance measurements
