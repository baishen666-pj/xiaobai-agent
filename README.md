# Xiaobai Agent

> 融合 Hermes + OpenClaw + Claude Code + Codex 四大项目优点的 AI Agent，支持多 Agent 编排和实时可视化 Dashboard。

## 架构融合来源

| 来源 | 融合特性 |
|------|----------|
| **Claude Code** | 简洁 Agentic Loop、四层压缩、流式并行工具执行、Hook 系统 |
| **Hermes Agent** | 闭环学习、渐进式技能、多提供商故障转移、子代理委派 |
| **OpenClaw** | 单写器架构、文件即内存、多通道网关、四层内存堆栈 |
| **OpenAI Codex** | 平台原生沙盒、双 MCP 角色、AGENTS.md 指令系统 |

## 核心特性

- **Agentic Loop** — `async function*` 生成器模式，流式输出
- **多 Agent 编排** — 6 个内置角色（coordinator/researcher/coder/reviewer/planner/tester），并行调度，依赖解析
- **可视化 Dashboard** — React 暗色主题面板，WebSocket 实时推送 Agent 状态、任务流、Token 消耗
- **8 大内置工具** — Bash, Read, Write, Edit, Grep, Glob, Memory, Agent
- **分层记忆** — MEMORY.md + USER.md + 会话搜索
- **多提供商** — Anthropic, OpenAI + 自动故障转移
- **安全沙盒** — read-only / workspace-write / full-access
- **Hook 系统** — 20+ 生命周期事件
- **MCP 双角色** — 兼作客户端和服务器
- **CLI 集成** — 8 个命令，开箱即用

## 快速开始

```bash
# 安装依赖
npm install

# 查看可用 Agent 角色
npx tsx src/cli/index.ts agents

# 启动交互式聊天
npx tsx src/cli/index.ts chat

# 单次执行
npx tsx src/cli/index.ts exec "解释这段代码"

# 启动 Dashboard
npx tsx src/cli/index.ts dashboard

# 多 Agent 编排执行
npx tsx src/cli/index.ts run "分析项目架构并生成报告" --role coordinator

# 查看配置
npx tsx src/cli/index.ts config show
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `xiaobai chat` | 交互式聊天（支持 /help /tools /memory /exit） |
| `xiaobai exec <prompt>` | 单次执行并退出 |
| `xiaobai run <prompt>` | 多 Agent 编排执行 |
| `xiaobai dashboard` | 启动实时 Dashboard（默认 3001 端口） |
| `xiaobai agents` | 列出可用 Agent 角色 |
| `xiaobai config show` | 查看当前配置 |
| `xiaobai memory list` | 查看记忆条目 |

### Dashboard 参数

```bash
xiaobai dashboard --port 8080     # 自定义端口
xiaobai dashboard --no-open       # 不自动打开浏览器
```

### Run 参数

```bash
xiaobai run "分析代码" --role researcher          # 指定角色
xiaobai run "修复 bug" --concurrency 5             # 最大并发数
xiaobai run "重构模块" --port 3001                 # 同时启动 Dashboard
```

## 项目结构

```
src/
├── cli/                # CLI 入口（8 个命令）
├── core/
│   ├── agent.ts        # XiaobaiAgent 主类
│   ├── loop.ts         # Agentic Loop 引擎
│   ├── orchestrator.ts # 多 Agent 编排器
│   ├── roles.ts        # Agent 角色定义
│   ├── task.ts         # 任务生命周期
│   └── workspace.ts    # 共享工作区
├── config/             # 分层配置管理
├── provider/           # LLM 提供商路由
├── tools/              # 工具注册表 + 内置工具
├── memory/             # 分层记忆系统
├── skills/             # SKILL.md 技能系统
├── security/           # 权限 + 危险命令检测
├── hooks/              # 生命周期 Hook
├── mcp/                # MCP 客户端 + 服务器
├── sandbox/            # 沙盒管理
├── session/            # 会话持久化
├── server/
│   ├── index.ts        # Dashboard HTTP + WebSocket 服务
│   └── eventBridge.ts  # Orchestrator → WebSocket 桥接
├── dashboard/
│   ├── App.tsx         # Dashboard 主界面
│   ├── App.css         # 暗色主题样式
│   ├── hooks/          # React WebSocket hook
│   └── components/     # Agent/Task/Token/Event 组件
└── utils/              # 工具函数
```

## 开发

```bash
npm test                # 运行测试（10 文件 84 测试）
npm run test:watch      # 监听模式
npm run typecheck       # 类型检查
npm run build:all       # 构建 Dashboard + TypeScript
npm run dev:dashboard   # Vite 开发服务器（热更新）
```

## 配置

配置文件位于 `~/.xiaobai/config.yaml`：

```yaml
model:
  default: claude-sonnet-4-6
  fallback: claude-haiku-4-5-20251001

provider:
  default: anthropic

memory:
  enabled: true
  memoryCharLimit: 2200
  userCharLimit: 1375

sandbox:
  mode: workspace-write

context:
  maxTurns: 90
  compressionThreshold: 0.5

permissions:
  mode: default
```

## Agent 角色

| 角色 | 工具 | 用途 |
|------|------|------|
| **Coordinator** | 全部 | 编排子 Agent，分解任务，综合结果 |
| **Researcher** | read/grep/glob/bash/memory | 调查代码库，搜索信息 |
| **Coder** | read/write/edit/bash/grep/glob | 编写和修改代码 |
| **Reviewer** | read/grep/glob/bash | 代码审查，质量检查 |
| **Planner** | read/grep/glob/memory | 创建实现计划 |
| **Tester** | read/write/edit/bash/grep/glob | 编写和运行测试 |

## License

MIT
