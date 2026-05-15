# Xiaobai Agent

> 融合 Hermes + OpenClaw + Claude Code + Codex 四大项目优点的全新 AI Agent

## 架构融合来源

| 来源 | 融合特性 |
|------|----------|
| **Claude Code** | 简洁 Agentic Loop、四层压缩、不可变参数模式、流式并行工具执行、20+ Hook 事件 |
| **Hermes Agent** | 闭环学习系统、渐进式技能披露、多提供商故障转移、委派模式、18+ LLM 提供商 |
| **OpenClaw** | 多通道网关、单写器架构、文件即内存、心跳调度、四层内存堆栈 |
| **OpenAI Codex** | 平台原生沙盒、双 MCP 角色、AGENTS.md 指令系统、无状态请求设计 |

## 核心特性

- **Agentic Loop**: 简洁的 `async function*` 生成器循环，无需 DAG 编排器
- **8 大内置工具**: Bash, Read, Write, Edit, Grep, Glob, Memory, Agent
- **四层压缩**: Snip -> Microcompact -> Context Collapse -> Auto-Compact（从低成本到高成本渐进）
- **分层记忆**: MEMORY.md (2200 chars) + USER.md (1375 chars) + 会话搜索
- **渐进式技能**: SKILL.md 按需加载，零 token 开销
- **多提供商**: Anthropic, OpenAI, Ollama 等 18+ 提供商，自动故障转移
- **安全沙盒**: read-only / workspace-write / full-access 三种模式
- **Hook 系统**: 20+ 生命周期事件，支持 command/http/prompt/mcp_tool 四种类型
- **MCP 双角色**: 兼作 MCP 客户端和 MCP 服务器
- **子代理**: 隔离上下文，支持并行研究、代码审查、多文件重构

## 快速开始

```bash
# 安装依赖
npm install

# 启动交互式聊天
npm run dev chat

# 单次执行
npm run dev exec "解释这段代码的功能"

# 查看配置
npm run dev config show
```

## 项目结构

```
src/
├── cli/            # CLI 入口（chat, exec, config, memory 命令）
├── core/           # 核心引擎（agent.ts, loop.ts）
├── config/         # 配置管理（分层配置 + 环境变量）
├── provider/       # LLM 提供商路由（Anthropic, OpenAI, 多提供商故障转移）
├── tools/          # 工具系统（注册表 + 8 大内置工具）
├── memory/         # 记忆系统（MEMORY.md + USER.md）
├── skills/         # 技能系统（SKILL.md 渐进披露）
├── security/       # 安全管理（权限模型 + 沙盒）
├── hooks/          # Hook 系统（20+ 生命周期事件）
├── mcp/            # MCP 集成（客户端 + 服务器双角色）
├── sandbox/        # 沙盒管理（平台原生隔离）
├── session/        # 会话管理（持久化 + 恢复）
└── utils/          # 工具函数
```

## 配置

配置文件位于 `~/.xiaobai/config.yaml`：

```yaml
model:
  default: claude-sonnet-4-6
  fallback: claude-haiku-4-5-20251001

provider:
  default: anthropic
  apiKey: ${ANTHROPIC_API_KEY}

memory:
  enabled: true
  memoryCharLimit: 2200
  userCharLimit: 1375

sandbox:
  mode: workspace-write

permissions:
  mode: default
  deny: []
  allow: []
```

## 指令系统

Xiaobai 支持分层指令文件（优先级从高到低）：

1. `~/.xiaobai/XIAOBAI.md` - 用户全局指令
2. `XIAOBAI.md` - 项目根目录（团队共享）
3. `.xiaobai/rules/*.md` - 规则文件
4. `AGENTS.md` - 递归目录遍历

## License

MIT
