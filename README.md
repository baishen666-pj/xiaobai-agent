# Xiaobai Agent

> Fusion AI agent — multi-agent orchestration, 18+ LLM providers, streaming CLI, MCP integration, real-time dashboard, skill system, and plugin marketplace.

## Features

- **Agentic Loop** — `async function*` generator pattern with streaming output and compaction
- **18+ LLM Providers** — Anthropic, OpenAI, DeepSeek, Qwen, Zhipu, Moonshot, Yi, Baidu, MiniMax, Baichuan, Google, Groq, Ollama, and more
- **Multi-Agent Orchestration** — 6 built-in roles (coordinator/researcher/coder/reviewer/planner/tester), parallel scheduling, dependency resolution
- **Real-time Dashboard** — React dark theme panel with WebSocket live agent status, task flow, and token consumption
- **8 Built-in Tools** — Bash, Read, Write, Edit, Grep, Glob, Memory, Agent
- **Three-tier Memory** — session / state / long-term with freeze snapshots
- **Skill System** — SKILL.md templates, auto-learning, hot-reload, plugin marketplace
- **Security** — sandbox policies, security audit, constant-time auth
- **Hook System** — 12 lifecycle events with allow/warn/block states
- **MCP** — dual role as both client and server
- **CLI** — 8 commands out of the box

## Install

```bash
npm install xiaobai-agent
```

## Quick Start

```bash
# Set up .env with your API key
echo "XIAOBAI_PROVIDER=deepseek" > .env
echo "DEEPSEEK_API_KEY=your-key" >> .env

# Start interactive chat
npx xiaobai chat

# Single execution
npx xiaobai exec "explain this code"

# Multi-agent orchestration
npx xiaobai run "analyze project architecture" --role coordinator

# Launch dashboard
npx xiaobai dashboard

# List agent roles
npx xiaobai agents

# View configuration
npx xiaobai config show
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `xiaobai chat` | Interactive chat (supports /help /tools /memory /exit) |
| `xiaobai exec <prompt>` | Single execution and exit |
| `xiaobai run <prompt>` | Multi-agent orchestration |
| `xiaobai dashboard` | Real-time dashboard (default port 3001) |
| `xiaobai agents` | List available agent roles |
| `xiaobai config show` | View current configuration |
| `xiaobai memory list` | View memory entries |
| `xiaobai skills list` | List installed skills |
| `xiaobai plugins list` | List installed plugins |

### Dashboard Options

```bash
xiaobai dashboard --port 8080     # Custom port
xiaobai dashboard --no-open       # Don't auto-open browser
```

### Run Options

```bash
xiaobai run "analyze code" --role researcher          # Specify role
xiaobai run "fix bug" --concurrency 5                  # Max concurrency
xiaobai run "refactor module" --port 3001              # Start dashboard too
```

## Configuration

### Environment Variables (recommended)

Create a `.env` file in your project root:

```env
# Provider selection
XIAOBAI_PROVIDER=deepseek

# API keys — set the ones you have
DEEPSEEK_API_KEY=sk-xxx
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
```

The system auto-discovers provider-specific keys:
- `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`
- `ZHIPU_API_KEY`, `QWEN_API_KEY`, `MOONSHOT_API_KEY`, `YI_API_KEY`, `BAIDU_API_KEY`, etc.

### Config File

Located at `~/.xiaobai/default/config.yaml`:

```yaml
model:
  default: deepseek-chat

provider:
  default: deepseek

memory:
  enabled: true
  memoryCharLimit: 2200

sandbox:
  mode: workspace-write

context:
  maxTurns: 90
  compressionThreshold: 0.5
```

Priority: environment variables > config.yaml > defaults.

## Supported Providers

| Provider | Env Key | Default Model |
|----------|---------|---------------|
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` |
| Google | `GOOGLE_API_KEY` | `gemini-2.0-flash` |
| Qwen | `QWEN_API_KEY` | `qwen-turbo` |
| Zhipu | `ZHIPU_API_KEY` | `glm-4-flash` |
| Moonshot | `MOONSHOT_API_KEY` | `moonshot-v1-8k` |
| Yi | `YI_API_KEY` | `yi-lightning` |
| Baidu | `BAIDU_API_KEY` | `ernie-4.0-8k` |
| Groq | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| Ollama | (none) | `llama3` |

## Agent Roles

| Role | Tools | Purpose |
|------|-------|---------|
| **Coordinator** | all | Orchestrate sub-agents, decompose tasks |
| **Researcher** | read/grep/glob/bash/memory | Investigate codebase |
| **Coder** | read/write/edit/bash/grep/glob | Write and modify code |
| **Reviewer** | read/grep/glob/bash | Code review, quality checks |
| **Planner** | read/grep/glob/memory | Create implementation plans |
| **Tester** | read/write/edit/bash/grep/glob | Write and run tests |

## Project Structure

```
src/
├── cli/                # CLI entry (8 commands)
├── core/
│   ├── agent.ts        # XiaobaiAgent main class
│   ├── loop.ts         # Agentic Loop engine
│   ├── orchestrator.ts # Multi-agent orchestrator
│   ├── roles.ts        # Agent role definitions
│   ├── compaction.ts   # Context compaction engine
│   ├── context.ts      # Hierarchical context loader
│   └── submissions.ts  # Typed queue-pair channels
├── config/             # Layered config management
├── provider/           # LLM provider router (18+ providers)
├── tools/              # Tool registry + built-in tools
├── memory/             # Three-tier memory system
├── skills/             # SKILL.md skill system
├── security/           # Permissions + security audit
├── hooks/              # Lifecycle hooks
├── mcp/                # MCP client + server
├── sandbox/            # Sandbox management
├── session/            # Session persistence
├── plugins/            # Plugin marketplace
├── server/             # Dashboard HTTP + WebSocket
├── dashboard/          # React dashboard UI
└── utils/              # Utilities
```

## Development

```bash
npm install             # Install dependencies
npm test                # Run tests (34 files, 414 tests)
npm run test:watch      # Watch mode
npm run typecheck       # Type check
npm run build:all       # Build dashboard + TypeScript
npm run dev             # Dev CLI
npm run dev:dashboard   # Dashboard dev server
```

## License

MIT
