# Changelog

All notable changes to Xiaobai Agent Framework are documented here.

## [0.7.0] - 2026-05-17

### Added

**Plugin SDK + Marketplace**
- Sandbox integration for plugins: filesystem and network isolation per plugin manifest
- `tools:execute` permission enforcement for plugin tool execution
- Unified marketplace merging in-memory search with file-backed install
- CLI commands: `plugins search`, `plugins browse`, `plugins activate`, `plugins deactivate`
- Plugin hot reload with 300ms debounce file watching
- `minAppVersion` validation during plugin load
- Example plugins: weather, web-search, calculator

**A2A/ACP Protocol Enhancement**
- A2A SSE streaming: `message/stream` endpoint with `onStreamMessage` handler
- A2A `tasks/list` endpoint with status filter, pagination
- A2A `contextId` support for conversation continuity
- ACP SSE streaming: `task/stream` with intermediate `task/message` events
- ACP parameter support: model override, token tracking
- `RemoteAgentBridge` for orchestrator-to-remote-agent task delegation
- Protocol configuration: `protocols.a2a` and `protocols.acp` in config

**Performance Optimization**
- `LazyLoader<T>` for deferred module loading
- `LRUCache<K,V>` with hit/miss tracking
- `ResponseCache` with TTL-based provider response caching
- OTLP trace exporter for distributed tracing
- Prometheus metrics exporter with `/metrics` endpoint
- `npm run bench` script for benchmark suite

**i18n + Documentation**
- Lightweight i18n system with locale detection and parameter interpolation
- English (`en`) and Simplified Chinese (`zh-CN`) locale files
- `--locale` CLI flag and `locale` config option
- `CHANGELOG.md`
- `docs/architecture.md` — system overview and module diagram
- `docs/plugins.md` — plugin development guide

## [0.6.0] - 2026-05-10

### Added
- Dashboard v2 multi-page SPA with React Router
- Sidebar navigation (Overview, Agents, Sessions, Workflows, Playground, Health)
- REST API client with AbortSignal support
- 6 new page components
- 9 new test files (55 tests)
- JS budget increased to 800KB for SPA features

## [0.5.0] - 2026-05-03

### Added
- Workflow engine with YAML definitions, step dependencies, and event system
- API gateway with CORS and rate limiting
- Production readiness: graceful shutdown, health endpoints, OpenAPI spec
- Telemetry system with distributed tracing and Chrome Trace export
- Vector persistence adapter (JSON file-based)
- SSE streaming for dashboard

## [0.4.0] - 2026-04-26

### Added
- CLI TUI multi-panel interface with Ink 7 and React 19
- Chat panel, input bar, status bar, permission dialog
- Real-time streaming and tool call rendering

## [0.3.0] - 2026-04-19

### Fixed
- 26 bug fixes (6 CRITICAL, 15 HIGH, 5 MEDIUM)
- Security: auth wiring, SSRF prevention, constant-time comparison
- Provider: per-provider circuit breaker, immutability fixes

## [0.2.0] - 2026-04-12

### Added
- Sub-agent engine with credential pooling and heartbeat monitoring
- A2A (Agent-to-Agent) and ACP (Agent Communication) protocol support
- Mem0 memory adapter
- Chinese LLM providers (DeepSeek, Qwen, Zhipu, Moonshot)
- Dashboard charts, theme toggle, auto-reconnect

## [0.1.0] - 2026-04-01

### Added
- Core agent loop with 18+ LLM provider support
- Multi-agent orchestration with 6 built-in roles
- Three-tier memory system (conversation, user profile, RAG)
- Plugin system with lifecycle management
- Skill system with 13 built-in templates
- Sandbox policy engine with filesystem and network ACL
- CLI with syntax highlighting and streaming markdown
- WebSocket dashboard with real-time event streaming
- MCP (Model Context Protocol) client
- AST code intelligence with tree-sitter
- Security: audit logging, authentication, RBAC
