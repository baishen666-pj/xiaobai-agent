---
name: doc-writer
description: Generate documentation (README, API docs, inline comments) with style guide
category: writing
version: 1.0.0
author: xiaobai
---

# Documentation Writer

Generate clear, structured documentation for the target.

## Documentation Types

- **README**: Project overview, installation, usage, API reference
- **API Reference**: Function/class documentation with types, examples, and edge cases
- **Architecture Docs**: System design, data flow, component relationships
- **Inline Comments**: Only for WHY, not WHAT — code should be self-documenting

## Style Guide

- Use present tense ("Returns the sum" not "Will return the sum")
- Use imperative mood for descriptions ("Calculate the total" not "Calculates the total")
- Lead with examples before explaining details
- Include type information inline
- Use markdown formatting for readability

## Output Format

### README Structure
```
# Project Name
> One-line description

## Installation
## Quick Start
## API Reference
## Configuration
## Contributing
## License
```

### API Doc Per Function
```
### `functionName(param1: Type, param2?: Type): ReturnType`

Brief description.

**Parameters:**
- `param1` — Description
- `param2` — Description (optional)

**Returns:** Description of return value

**Example:**
```typescript
const result = functionName('hello');
```
```

## Variables

- `{{target}}` — The code or project to document
- `{{doc_type}}` — Type of documentation (readme, api, architecture, comments)
- `{{audience}}` — Target audience (developers, end-users, contributors)
