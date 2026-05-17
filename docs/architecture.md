# Architecture

## System Overview

Xiaobai is a fusion AI agent framework with multi-agent orchestration, 18+ LLM providers, streaming CLI, MCP integration, real-time dashboard, skill system, and plugin marketplace.

## Module Diagram

```
User Input
    │
    ▼
┌─────────┐    ┌──────────────┐
│  CLI/REPL│◄──►│   Dashboard   │  React SPA + WebSocket
│ (Ink TUI)│    │  (Vite/React) │
└────┬─────┘    └──────┬───────┘
     │                 │
     ▼                 ▼
┌─────────────────────────────┐
│        XiaobaiAgent          │  Core orchestrator
│  ┌────────┐  ┌───────────┐  │
│  │  Loop   │  │  Context   │  │  Agent loop + context mgmt
│  └────┬───┘  └─────┬─────┘  │
│       │            │         │
│  ┌────▼────────────▼──────┐  │
│  │    ProviderRouter       │  │  18+ LLM providers
│  │  ┌─────┐ ┌─────┐      │  │
│  │  │ CB  │ │  RL  │      │  │  Circuit breaker + rate limiter
│  │  └─────┘ └─────┘      │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │      ToolRegistry       │  │  20+ built-in tools
│  └────────────────────────┘  │
└──────────┬───────────────────┘
           │
     ┌─────┼─────┬──────┬──────┐
     ▼     ▼     ▼      ▼      ▼
┌───────┐┌─────┐┌─────┐┌─────┐┌─────┐
│Memory ││ MCP ││Skill││Plugin││Work-│
│System ││     ││System││System││flow │
│(RAG)  ││     ││     ││      ││     │
└───────┘└─────┘└─────┘└─────┘└─────┘
```

## Core Modules

| Module | Location | Purpose |
|--------|----------|---------|
| Agent | `src/core/agent.ts` | Agent factory, lifecycle management |
| Loop | `src/core/loop.ts` | Chat loop with streaming events |
| Context | `src/core/context.ts` | Conversation context with compression |
| Orchestrator | `src/core/orchestrator.ts` | Multi-agent task planning and execution |
| SubAgent | `src/core/sub-agent.ts` | Child agent spawning with credential pooling |
| Roles | `src/core/roles.ts` | 6 built-in agent roles (coordinator, researcher, coder, reviewer, planner, tester) |

## Infrastructure Modules

| Module | Location | Purpose |
|--------|----------|---------|
| Config | `src/config/manager.ts` | Three-tier config: env > YAML > defaults |
| Provider | `src/provider/router.ts` | LLM provider routing with fallbacks |
| Memory | `src/memory/system.ts` | Three-tier memory with RAG |
| Session | `src/session/manager.ts` | Session persistence and CRUD |
| Sandbox | `src/sandbox/manager.ts` | Filesystem/network ACL for tool execution |
| Security | `src/security/auth.ts` | Bearer token + Basic auth |
| Telemetry | `src/telemetry/tracer.ts` | Distributed tracing with spans |

## Extension Modules

| Module | Location | Purpose |
|--------|----------|---------|
| Plugins | `src/plugins/` | Plugin lifecycle, marketplace, sandbox |
| Skills | `src/skills/system.ts` | Markdown-based prompt templates |
| Hooks | `src/hooks/system.ts` | Event-based hook system |
| MCP | `src/mcp/` | Model Context Protocol client |
| Protocols | `src/protocols/` | A2A and ACP inter-agent protocols |
| Workflow | `src/workflow/` | YAML-based workflow engine |

## Dashboard

- **Framework**: React 19 + Vite, served from `src/dashboard/`
- **Routing**: React Router 7.x with sidebar navigation
- **Real-time**: WebSocket for events, SSE for streaming
- **Pages**: Overview, Agents, Sessions, Workflows, Playground, Health
- **Build**: `vite build` outputs to `public/`, served by dashboard server

## Data Flow

1. User input → CLI/REPL/Dashboard
2. Agent creates Loop with Context
3. Loop sends to ProviderRouter → LLM Provider
4. Response parsed for tool calls → ToolRegistry executes
5. Tool results fed back to Loop
6. Events emitted to subscribers (dashboard, telemetry)
7. Memory system updated with conversation data

## Configuration Hierarchy

```
Environment Variables (highest)
    ↓
~/.xiaobai/<profile>/config.yaml
    ↓
Hardcoded Defaults (lowest)
```

## Testing

- **Framework**: Vitest 3.2
- **Coverage**: 90% statement threshold, 85% branch threshold
- **Types**: Unit, Integration, E2E, Benchmark
- **Location**: `tests/` (mirrors `src/` structure)
