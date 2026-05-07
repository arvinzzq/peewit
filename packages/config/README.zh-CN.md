# Config Package

English version: [README.md](./README.md)

## 架构概述

`@vole/config` 负责**配置加载和验证**。它将默认配置、用户配置、项目配置和环境变量覆盖合并为单一的 `EffectiveConfig` 对象，驱动所有运行时行为。它还在配置显示到 trace 或 CLI 输出前将密钥进行脱敏处理。

```
defaults
  + userConfig（JSON）
  + projectConfig（JSON）
  + 环境变量
      │
      ▼
  loadConfig()
      │
      ▼
EffectiveConfig   ←─── CLI 和 Web Adapter 消费
      │
      ▼
  redactedConfig()  ←─── 安全用于日志或显示
```

## 核心概念

### EffectiveConfig

单一合并后的配置对象，包含以下主要 section：

- `model`：provider（openai-compatible / anthropic）、baseURL、model 名称、temperature、maxTokens、可选的 thinkingBudget
- `workspace`：root 目录
- `runtime`：defaultMode（autonomy）、maxSteps、可选的 promptMode、executionContract、toolProfile、sandboxed
- `trace`：verbosity
- `tools`：fileSystem、shell、web 开关
- `permissions`：allowLowRisk
- `sessions`：directory 路径
- `memory`：longTermFiles 策略、writes 策略
- `secrets`：apiKey（未脱敏）

### 配置优先级

四层按顺序合并，后层覆盖前层：

1. **默认值**：硬编码——`openai-compatible` provider、`gpt-4.1-mini`、`confirm` 模式、`maxSteps: 12`。
2. **用户配置**：通常为 `~/.vole/config.json`——个人偏好。
3. **项目配置**：通常为工作区中的 `.vole/config.json`——项目特定覆盖。
4. **环境变量**：最高优先级，最后应用。

### 环境变量参考

| 环境变量 | 效果 |
|---|---|
| `OPENROUTER_API_KEY` | 设置 provider 为 openai-compatible、baseURL 为 OpenRouter、设置 API key |
| `ANTHROPIC_API_KEY` | 设置 provider 为 anthropic、model 为默认 Haiku、设置 API key |
| `VOLE_API_KEY` | 仅设置 API key（不改变 provider） |
| `VOLE_MODEL` | 覆盖 model 名称 |
| `VOLE_BASE_URL` | 覆盖 model base URL |
| `VOLE_DEFAULT_MODE` | 覆盖运行时自主模式（observe/confirm/auto） |
| `VOLE_WORKSPACE_ROOT` | 覆盖工作区根目录 |
| `VOLE_LONG_TERM_MEMORY` | 覆盖 memory.longTermFiles 策略 |
| `VOLE_PROMPT_MODE` | 覆盖 promptMode（full/minimal/none） |
| `VOLE_EXECUTION_CONTRACT` | 覆盖执行契约（default/strict-agentic） |
| `VOLE_TOOL_PROFILE` | 覆盖工具配置（coding/full/messaging/background） |
| `VOLE_SANDBOX` | `"true"` 时启用 shell 沙箱模式 |
| `VOLE_THINKING_BUDGET` | 设置 Anthropic thinking budget |

### Provider 选择快捷方式

设置 `OPENROUTER_API_KEY` 自动配置 OpenRouter base URL 并切换到 `openai-compatible` provider（仍需 `VOLE_MODEL`）。设置 `ANTHROPIC_API_KEY` 自动配置 `anthropic` provider 和默认 Haiku 模型。这些快捷方式识别用户通常在 shell profile 中设置的密钥变量，避免需要额外的 `VOLE_API_KEY` 变量。

### 验证

`validateConfig()` 在所有层应用后调用，验证 provider 名称、model 非空（捕获设置了 `OPENROUTER_API_KEY` 但未指定 model 的情况）、autonomy mode、trace verbosity、memory 策略、promptMode、executionContract、toolProfile 和 thinkingBudget 的合法性。

验证失败抛出 `ConfigValidationError`（继承 `Error`），Adapter 可与意外错误分别捕获。

### 密钥脱敏

`redactedConfig(config)` 返回 `RedactedConfigView`，将 `secrets.apiKey` 替换为 `"configured"` 或 `"missing"`，安全用于日志、trace 序列化或 `--config` 输出。

### resolveSessionsDirectory

将 `~/` 展开为 `$HOME`，确保默认的 `~/.vole/sessions` 在任何机器上正确解析。CLI 和 Web Adapter 都调用此辅助函数，保证始终指向相同目录。

## 实现原理

### 合并策略

`applyConfig()` 用简单的键覆盖策略合并配置 section：对输入 section 中同时存在于目标的每个键，覆盖目标值。未知键（拼写错误、未来字段）静默忽略。这种宽松策略避免了 schema 验证库依赖，保持向前兼容性。

### 为何独立一个包

配置加载与所有其他领域关注点无关，不依赖 `@vole/core`、`@vole/models` 或任何其他工作区包。这意味着 CLI 或纯配置命令（`vole config show`）可以导入 `@vole/config` 而无需拉取整个运行时栈。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 config 包（不依赖其他工作区包）。 |
| `tsconfig.json` | TypeScript 配置 | 构建 config 包。 |
| `src/index.ts` | 配置加载器 | 所有导出：`EffectiveConfig`、`RedactedConfigView`、`LoadConfigInput`、`ConfigValidationError`、`loadConfig`、`redactedConfig`、`resolveSessionsDirectory`、所有类型别名。 |
| `src/index.test.ts` | 配置测试 | 保护所有环境变量处理、优先级、provider 快捷方式、脱敏和验证错误信息。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。
