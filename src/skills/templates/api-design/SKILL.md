---
name: api-design
description: REST/GraphQL API design with endpoint specification, schema definition, and contract-first approach
category: design
version: 1.0.0
author: xiaobai
---

# API Design

Design clean, consistent APIs following contract-first principles.

## Design Process

1. Identify resources and relationships from requirements
2. Define endpoints with methods, paths, and status codes
3. Specify request/response schemas with types
4. Add error handling, pagination, and filtering contracts
5. Document authentication, rate limiting, and versioning

## REST Conventions

| Aspect | Convention |
|--------|-----------|
| URLs | kebab-case, plural nouns (`/api/v1/user-accounts`) |
| Methods | GET (read), POST (create), PUT (replace), PATCH (update), DELETE (remove) |
| Status Codes | 200 (OK), 201 (Created), 204 (No Content), 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 409 (Conflict), 422 (Unprocessable), 429 (Rate Limited), 500 (Internal Error) |
| Pagination | `?page=1&limit=20` with total count in response |
| Filtering | `?status=active&created_after=2024-01-01` |
| Sorting | `?sort=-created_at,name` (prefix `-` for descending) |

## Response Envelope

```typescript
// Success
{ "ok": true, "data": T, "meta": { "page": 1, "limit": 20, "total": 100 } }

// Error
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

## Design Checklist

- [ ] Every endpoint has clear input/output types
- [ ] Error responses use consistent format
- [ ] Destructive operations require confirmation
- [ ] List endpoints support pagination
- [ ] Write endpoints validate input
- [ ] Rate limiting defined per endpoint group
- [ ] Versioning strategy documented

## Output Format

```
## Endpoint: METHOD /path

**Description**: What this endpoint does

**Auth**: Required role/permission

**Request**:
- Headers: ...
- Path params: ...
- Query params: ...
- Body schema: ...

**Response 200**: Success schema
**Response 4xx/5xx**: Error scenarios

**Example**:
[Request/response example]
```

## Variables

- `{{requirements}}` — The feature or system requirements
- `{{style}}` — API style (rest, graphql, grpc)
- `{{existing_api}}` — Optional: existing API to extend or migrate
