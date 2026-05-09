# vole-agent

功能强大的编程和通用智能体，在终端中运行。

## 安装

```bash
npm install -g vole-agent
```

## 配置

在 shell 配置文件或项目根目录的 `.env` 文件中设置 API key：

```bash
# Anthropic
export VOLE_API_KEY=sk-ant-...

# 或 OpenRouter
export OPENROUTER_API_KEY=sk-or-...
```

## 使用

```bash
# 交互式对话
vole chat

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
| `vole chat` | 开始交互式对话 |
| `vole chat --resume` | 恢复最近的会话 |
| `vole chat --session <id>` | 恢复指定会话 |
| `vole run "<目标>"` | 运行一次性后台任务 |
| `vole web` | 打开 Web 界面 |
| `vole sessions` | 列出所有会话 |
| `vole tasks` | 列出后台任务记录 |
| `vole skills` | 管理智能体技能 |

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

## 环境变量配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VOLE_API_KEY` | — | Anthropic API key |
| `OPENROUTER_API_KEY` | — | OpenRouter API key（备选） |
| `VOLE_MODEL` | `claude-sonnet-4-6` | 使用的模型 |
| `VOLE_MODEL_PROVIDER` | `anthropic` | 提供商（`anthropic` 或 `openai-compatible`） |
| `VOLE_MAX_TOKENS` | `16000` | 最大输出 token 数 |

## 许可证

MIT
