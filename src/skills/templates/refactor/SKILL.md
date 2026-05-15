---
name: refactor
description: Safe refactoring with behavior preservation verification and refactoring catalog
category: coding
version: 1.0.0
author: xiaobai
---

# Refactoring

Refactor the target code while preserving behavior.

## Methodology

1. Analyze the current code structure and identify code smells
2. Propose specific refactoring from the catalog below
3. Apply the refactoring incrementally
4. Verify behavior preservation after each step

## Safety Checks

Before marking refactoring complete:
- Existing tests still pass
- Function signatures remain compatible (or are explicitly updated)
- No new linting/type errors introduced
- Public API unchanged (unless explicitly requested)

## Refactoring Catalog

| Refactoring | When to Use |
|-------------|-------------|
| Extract Function | Function > 50 lines or mixed responsibilities |
| Rename Variable | Name doesn't convey intent |
| Introduce Parameter Object | Function has 3+ related parameters |
| Replace Conditional with Polymorphism | Complex switch/if-else chains |
| Extract Interface | Multiple implementations share a shape |
| Move Method | Method uses more data from another class |
| Decompose Conditional | Complex boolean logic in conditionals |

## Output Format

For each refactoring step:
1. Describe the change and why
2. Show before/after code
3. Verify tests pass
4. Note any breaking changes

## Variables

- `{{target_file}}` — The file to refactor
- `{{refactor_type}}` — Specific refactoring to apply (e.g., "extract-function", "rename")
- `{{description}}` — Description of what the refactoring should achieve
