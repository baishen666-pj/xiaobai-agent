---
name: test-gen
description: Generate tests following AAA (Arrange-Act-Assert) pattern with coverage strategy
category: coding
version: 1.0.0
author: xiaobai
---

# Test Generation

Generate comprehensive tests for the target file following the Arrange-Act-Assert pattern.

## Methodology

1. Analyze the target function/module to understand all code paths
2. Identify edge cases, boundary conditions, and error scenarios
3. Generate tests using AAA pattern with descriptive names
4. Ensure each test is isolated and deterministic

## Coverage Strategy

Generate tests for:
- **Happy path**: The primary use case works correctly
- **Boundary conditions**: Empty inputs, maximum values, edge cases
- **Error cases**: Invalid inputs, missing dependencies, permission denied
- **Integration points**: External API calls, database queries (mocked)

## Test Naming

Use descriptive names that explain the behavior:

```
returns empty array when no items match
throws ValidationError when input is negative
falls back to cache when API is unavailable
```

## Output Format

```javascript
describe('moduleName', () => {
  test('behavior description', () => {
    // Arrange
    const input = ...;

    // Act
    const result = functionUnderTest(input);

    // Assert
    expect(result).toBe(expected);
  });
});
```

## Variables

- `{{target_file}}` — The file to generate tests for
- `{{framework}}` — Test framework to use (vitest, jest, mocha, etc.)
