# vole-agent

功能强大的编程和通用智能体，在终端中运行。

## 安装

```bash
npm install -g vole-agent
```

## 配置

将 API key 写入 `~/.vole/config.json`（首次运行时自动创建）：

```json
{ "apiKey": "sk-ant-..." }
```

或在 shell 配置文件中设置环境变量：

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Anthropic
export OPENROUTER_API_KEY=sk-or-...   # OpenRouter
```

在 git 仓库中运行时，会话存储在 `<git-root>/.vole/sessions/`；否则存储在 `~/.vole/sessions/`。

## 使用

```bash
# 交互式对话（在真实终端中，直接执行 vole 默认进入 chat）
vole
vole chat                              # 显式形式

# 恢复上次会话
vole chat --resume

# 一次性任务
vole run "重构 auth 模块，使用 async/await"

# Web 界面
vole web

# 列出会话
vole sessions
```

## 命令

| 命令 | 说明 |
|---|---|
| `vole` | 无参数调用默认进入交互式聊天（stdin 是真实终端时） |
| `vole chat` | 开始交互式对话 |
| `vole chat --resume` | 恢复最近的会话 |
| `vole chat --session <id>` | 恢复指定会话 |
| `vole run "<目标>"` | 运行一次性后台任务 |
| `vole run --dream` | 将日记合并进 `MEMORY.md` |
| `vole web` | 打开 Web 界面 |
| `vole sessions` | 列出所有会话 |
| `vole tasks` | 列出后台任务记录 |
| `vole skills` | 列出已加载技能（含 `install`/`enable`/`disable`/`trust`/`review` 子命令） |
| `vole daemon` | 启动 Cron 调度守护进程（`--once` 仅执行一次） |
| `vole taskflow list/show/cancel` | 查看跨会话任务记录 |
| `vole gateway status` | 显示当前进程的 lane 占用与跨进程 session 锁 |
| `vole subagents list` | 列出近期子代理任务记录（taskflow） |
| `vole subagents kill <id\|all>` | 把子代理任务标记为已取消（或用 "all" 停掉所有 running） |
| `vole doctor` | 只读诊断：workspace、sessions、taskflow、skills 状态 |
| `vole memory review` | 列出 DREAMS.md 中待审阅的候选条目 |
| `vole memory review approve <id\|all>` | 把 DREAMS.md 条目提升到 MEMORY.md |
| `vole memory review reject <id\|all>` | 把 DREAMS.md 条目归档到 DREAMS/archive/ |
| `vole migrate jsonl-to-sqlite` | 预览 JSONL → SQLite 迁移（sessions + taskflow），不实际写入 |
| `vole migrate jsonl-to-sqlite --apply` | 实际写入 SQLite 数据库 |

## 对话内指令

在 `vole chat` 中可用：

| 指令 | 说明 |
|---|---|
| `/resume` | 选择并恢复历史会话 |
| `/clear` | 清屏并重置上下文 |
| `/trace` | 查看最近事件追踪 |
| `/config` | 查看当前配置 |
| `/skills` | 列出已加载技能 |
| `/help` | 显示所有指令 |
| `/exit` | 退出对话 |

## 环境变量与配置文件

配置加载优先级：环境变量 → `vole.config.json`（项目级）→ `~/.vole/config.json`（用户级）→ 默认值。

**配置文件格式**（`~/.vole/config.json` 或 `vole.config.json`）：

```json
{
  "apiKey": "sk-ant-...",
  "model": "claude-haiku-4-5",
  "defaultMode": "confirm"
}
```

**环境变量：**

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | 使用 Anthropic Provider（claude-haiku-4-5） |
| `OPENROUTER_API_KEY` | — | 使用 OpenRouter（需配合 `VOLE_MODEL`） |
| `VOLE_API_KEY` | — | 通用 API Key 覆盖 |
| `VOLE_BASE_URL` | `https://api.openai.com/v1` | Provider Base URL |
| `VOLE_MODEL` | `gpt-4.1-mini` | 模型名称 |
| `VOLE_DEFAULT_MODE` | `confirm` | 自主模式：`observe` / `confirm` / `auto` |
| `VOLE_WORKSPACE_ROOT` | `.` | 工作目录 |
| `VOLE_LONG_TERM_MEMORY` | `disabled` | 记忆策略：`disabled` / `read-only` / `write` |
| `VOLE_PROMPT_MODE` | `full` | 提示词渲染：`full` / `minimal` / `none` |
| `VOLE_EXECUTION_CONTRACT` | `default` | 执行纪律：`default` / `strict-agentic` |
| `VOLE_TOOL_PROFILE` | `full` | 工具能力集：`coding` / `full` / `messaging` / `background` |
| `VOLE_SANDBOX` | `false` | 将 Shell 限制在工作区根目录：`true` / `false` |
| `VOLE_THINKING_BUDGET` | `adaptive` | Anthropic 推理深度：`off` / `minimal` … `max` / `adaptive` |

## 许可证

MIT
