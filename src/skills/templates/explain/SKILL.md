---
name: explain
description: Code explanation with complexity analysis at multiple detail levels
category: analysis
version: 1.0.0
author: xiaobai
---

# Explain

Explain the target code at the requested detail level with complexity analysis.

## Explanation Levels

### Overview
High-level summary: What does this code do and why does it exist?
Suitable for: newcomers, architecture reviews

### Detailed Walkthrough
Step-by-step explanation of the main code paths.
Covers: control flow, data transformations, side effects
Suitable for: code reviews, debugging

### Line-by-Line
Every significant line explained with context.
Covers: type information, edge cases, invariants
Suitable for: learning, deep debugging

## Complexity Analysis

For each function/method, analyze:

| Metric | Description |
|--------|-------------|
| Time Complexity | Big-O with explanation |
| Space Complexity | Memory usage pattern |
| Cyclomatic Complexity | Number of independent paths |
| Cognitive Complexity | How hard to understand |

## Dependency Graph

Identify and describe:
- Direct dependencies (imports, function calls)
- Indirect dependencies (transitive)
- External dependencies (libraries, APIs)

## Output Format

```
## Overview
[2-3 sentence summary]

## How It Works
[Detailed explanation at the chosen level]

## Complexity Analysis
| Function | Time | Space | Cyclomatic |
|----------|------|-------|------------|
| foo()    | O(n) | O(1)  | 3          |

## Dependencies
- [dep1]: [purpose]
- [dep2]: [purpose]

## Key Invariants
- [Invariant 1]: [Why it holds]
```

## Variables

- `{{target}}` — The code to explain
- `{{detail_level}}` — Level of detail (overview, detailed, line-by-line)
