---
name: git-ops
description: Git workflow operations with conventional commits, branch strategy, and conflict resolution
category: coding
version: 1.0.0
author: xiaobai
requires:
  bins:
    - git
---

# Git Operations

Manage git workflows with structured commits, branching, and history management.

## Commit Format

```
<type>: <description>

<optional body>
```

### Types

| Type | Usage |
|------|-------|
| feat | New feature |
| fix | Bug fix |
| refactor | Code restructuring without behavior change |
| perf | Performance improvement |
| test | Adding or updating tests |
| docs | Documentation changes |
| chore | Build, config, tooling |
| ci | CI/CD changes |

### Rules

- Subject line under 72 characters
- Use imperative mood ("add feature" not "added feature")
- Body explains WHY, not WHAT (diff shows what)
- One logical change per commit

## Branch Strategy

| Branch | Purpose | Naming |
|--------|---------|--------|
| main | Production-ready code | `main` |
| develop | Integration branch | `develop` |
| feature | New feature work | `feat/short-description` |
| fix | Bug fix | `fix/issue-description` |
| release | Release preparation | `release/v1.2.0` |
| hotfix | Emergency fix | `hotfix/critical-fix` |

## Operations

### Clean History
- Prefer rebase over merge for local branches
- Squash related commits before merge
- Keep merge commits meaningful

### Conflict Resolution
1. Identify conflicting files
2. Understand both sides of the conflict
3. Resolve by choosing or combining changes
4. Verify resolved code compiles and tests pass
5. Complete the rebase/merge

## Variables

- `{{operation}}` — Git operation to perform (commit, branch, merge, rebase, resolve)
- `{{scope}}` — Files or scope of the change
- `{{message}}` — Optional: commit message or description
