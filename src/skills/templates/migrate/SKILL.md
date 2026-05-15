---
name: migrate
description: Framework and library migration with compatibility mapping and incremental upgrade strategy
category: coding
version: 1.0.0
author: xiaobai
---

# Migration

Plan and execute framework or library migrations with minimal risk.

## Migration Process

1. **Assess**: Identify current usage patterns and breaking changes
2. **Plan**: Create incremental migration steps with rollback points
3. **Map**: Build compatibility mapping between old and new APIs
4. **Execute**: Apply changes incrementally, testing after each step
5. **Verify**: Full test suite passes, no regressions

## Assessment Checklist

- [ ] Identify all usages of the target library/framework
- [ ] Review changelog and migration guide for breaking changes
- [ ] List deprecated APIs and their replacements
- [ ] Check peer dependency compatibility
- [ ] Identify code-generate or config-file changes needed

## Migration Strategies

| Strategy | When to Use |
|----------|-------------|
| Codemod first | Mechanical API renames, large codebase |
| Shim layer | Gradual migration, mixed old/new during transition |
| Big bang | Small codebase, clean break possible |
| Feature flag | Risky migration, need instant rollback |

## Compatibility Mapping

For each API change, document:

```
| Old API | New API | Notes |
|---------|---------|-------|
| oldFunc(a, b) | newFunc({ a, b }) | Positional → named params |
| OldClass.method() | NewClass.staticMethod() | Renamed |
```

## Output Format

```
## Migration Plan: [from] → [to]

### Phase 1: [Preparation]
- [ ] Step 1
- [ ] Step 2

### Phase 2: [Core Migration]
- [ ] Step 3
- [ ] Step 4

### Phase 3: [Cleanup]
- [ ] Remove shims
- [ ] Update dependencies

### Rollback Plan
[How to undo if things go wrong]
```

## Variables

- `{{source}}` — Current framework/library and version
- `{{target}}` — Target framework/library and version
- `{{codebase}}` — The code to migrate
- `{{strategy}}` — Preferred strategy (codemod, shim, big-bang, feature-flag)
