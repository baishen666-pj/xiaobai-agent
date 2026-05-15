---
name: architect
description: System architecture design with component diagrams, data flow, and decision records
category: design
version: 1.0.0
author: xiaobai
---

# Architecture Design

Design system architecture with clear component boundaries and data flow.

## Design Process

1. **Requirements**: Extract functional and non-functional requirements
2. **Components**: Identify major components and their responsibilities
3. **Interfaces**: Define contracts between components
4. **Data Flow**: Map how data moves through the system
5. **Decisions**: Document key architectural decisions (ADRs)
6. **Tradeoffs**: Analyze alternatives and justify choices

## Architecture Patterns

| Pattern | When to Use |
|---------|-------------|
| Layered | Simple CRUD apps, clear separation of concerns |
| Event-Driven | Decoupled systems, async workflows |
| Microservices | Independent scaling, team autonomy |
| Plugin | Extensible systems, third-party integrations |
| CQRS | Read-heavy with complex query patterns |
| Hexagonal | Framework-agnostic business logic |

## Quality Attributes

Evaluate the design against:

| Attribute | Question |
|-----------|---------|
| Scalability | Can it handle 10x current load? |
| Reliability | What happens when a component fails? |
| Latency | What are the critical path latencies? |
| Security | Where are the trust boundaries? |
| Maintainability | How easy to add a new feature? |
| Testability | Can components be tested in isolation? |

## Output Format

```
## System Overview
[One paragraph describing the system]

## Component Diagram
[ASCII diagram or description of components and connections]

## Component Catalog

### [Component Name]
- Responsibility: [what it does]
- Dependencies: [what it depends on]
- Interface: [public API or contract]
- Data owned: [what data it manages]

## Data Flow
[How data moves through the system for key scenarios]

## Architecture Decision Records

### ADR-001: [Decision Title]
- Context: [why this decision is needed]
- Decision: [what was decided]
- Consequences: [tradeoffs and implications]
```

## Variables

- `{{requirements}}` — System requirements and constraints
- `{{constraints}}` — Technical or organizational constraints
- `{{scale}}` — Expected scale (users, data volume, throughput)
