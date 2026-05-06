# Configuration System

状态：草案
日期：2026-05-02

English version: [configuration-system.md](./configuration-system.md)

## 1. 目的

Configuration system 定义 Peewit 如何加载非敏感设置、secret references、默认值和 runtime overrides。

它应该让产品可以简单启动，同时防止配置逻辑泄漏到 Agent Core、model providers、tools、permissions 或 CLI 中。

核心规则：

模块接收 effective configuration object。它们不应该各自重新发现 files、environment variables 或 secrets。

## 2. 为什么这个模块存在

Configuration 会影响通用 Agent 的几乎每个部分：

- 使用哪个 model provider
- 选择哪个 model
- 哪个 workspace 处于 active 状态
- 启用哪些 tools
- 默认 permission mode 是什么
- Trace 如何渲染
- Sessions 存储在哪里
- 哪个 Web/search provider 可用

如果没有共享 configuration boundary，第一版 CLI implementation 会把配置读取分散到代码库各处，也会让未来 Web UI 或 background runs 更难加入。

## 3. 配置层

MVP 层级：

1. 内置默认值
2. 用户配置：`~/.peewit/config.json`
3. 项目配置：`<workspace>/peewit.config.json`
4. 环境变量
5. CLI flags
6. 明确支持时的 runtime chat commands

后续层级：

- 本地未提交的项目配置
- 加密本地 secret store
- OS keychain 集成
- 组织或团队 policy config

## 4. 优先级

推荐优先级，越靠上优先级越高：

```text
Runtime command
  -> CLI flag
  -> Environment variable
  -> Project config
  -> User config
  -> Built-in default
```

Project config 应只针对 project-scoped behavior 覆盖用户偏好。当项目未指定时，user config 仍应拥有用户特定默认值。

Secrets 不应作为可直接展示的 raw values 被复制到最终对象中，除非消费 adapter 只需要 redacted status。

## 5. MVP 配置形状

具体 schema 可以在实现阶段细化，但 MVP 应覆盖：

```json
{
  "model": {
    "provider": "openai-compatible",
    "baseURL": "https://api.example.com/v1",
    "model": "example-model",
    "temperature": 0.2,
    "maxTokens": 4096
  },
  "workspace": {
    "root": "."
  },
  "runtime": {
    "defaultMode": "confirm",
    "maxSteps": 12
  },
  "trace": {
    "verbosity": "explainable"
  },
  "tools": {
    "fileSystem": true,
    "shell": true,
    "web": false
  },
  "permissions": {
    "allowLowRisk": true
  },
  "sessions": {
    "directory": "~/.peewit/sessions"
  }
}
```

MVP 应保持这个 schema 小而明确。

## 6. 密钥

Secrets 不能存进 workspace prompt files 或已提交 project config。

MVP secret sources：

- `PEEWIT_API_KEY`
- `OPENROUTER_API_KEY`，除非同时设置 generic Peewit overrides，否则它会选择 OpenRouter OpenAI-compatible endpoint

未来 secret sources：

- Provider-specific keys，例如 `PEEWIT_OPENAI_API_KEY`
- 加密本地 secret file
- OS keychain
- 用于 team deployments 的 cloud secret provider

Effective config 可以包含 secret presence metadata，例如 “configured” 或 “missing”，但 trace 和 CLI config views 不能打印 raw values。

## 7. 验证

Configuration loading 应验证：

- 未知顶层 sections
- 无效 enum values
- 无效 URLs
- 无效数字范围
- 缺少必需 model settings
- 冲突选项
- 无法解析的 secret references

错误应该可行动，并且适合 adapter 展示。

示例：

```text
Missing API key for provider "openai-compatible".
Set PEEWIT_API_KEY, OPENROUTER_API_KEY, or configure a supported secret source.
```

## 8. 脱敏

在 CLI、trace、logs 或未来 Web UI 中展示的配置值必须被脱敏。

需要脱敏：

- API keys
- Tokens
- Private keys
- Passwords
- Secret-like values
- 如果暴露会造成敏感风险的 secret file paths

Redaction function 应尽可能与 trace 和 prompt assembly 共享。

## 9. 与 CLI 的关系

CLI 在启动时通过共享 config loader 加载配置。

CLI 可以展示：

- 生效的 model provider
- 生效的 model name
- Workspace root
- Default mode
- Trace verbosity
- Enabled tool categories
- 必需 secrets 是否已配置

CLI 不能展示 raw secrets。

## 10. 与 Agent Core 的关系

Agent Core 应接收已经配置好的 runtime dependencies。

它可以接收安全的 runtime settings，例如：

- Autonomy mode
- Maximum loop steps
- Trace verbosity
- Workspace metadata

它不应该直接读取 config files 或 environment variables。

## 11. 与 Model Providers 的关系

Application composition 基于 effective configuration 创建 provider。

Provider 接收：

- Base URL
- Model name
- Temperature
- Token budget
- 通过 secret layer 解析出的 secret value

Model provider 文档负责 provider behavior。Configuration system 负责 loading、validation、precedence 和 redaction。

## 12. 与 Permissions 的关系

Configuration 可以影响 permission defaults，但不能静默抹掉安全边界。

示例：

- Default mode 可以是 `observe`、`confirm` 或 `auto`。
- Low-risk auto-allow 可以启用。
- 后续可以增加 project command policies。
- Blocked actions 保持 blocked，除非存在明确 high-trust policy。

Permission package 拥有最终 risk decisions。

## 13. 与 Workspace Files 的关系

Configuration files 和 workspace prompt files 是不同表面。

- `peewit.config.json` 配置 runtime behavior。
- `AGENTS.md` 和相关文件指导 agent behavior。
- Prompt files 不能存储 secrets。
- Prompt files 不能覆盖 permission policy。

Context package 可以把安全 config metadata 放进 model context，但不能放入 raw secrets。

## 14. 测试要求

Configuration 需要测试，因为它影响安全、启动和可复现性。

必需测试领域：

- 层级优先级
- 默认值
- 项目配置加载
- 用户配置加载
- 环境变量覆盖
- 加入 CLI flags 后的 CLI flag 覆盖
- Schema 验证
- Secret presence detection
- 脱敏
- 错误信息
- 确保 Agent Core 不直接读取 config sources

任何改变 model providers、tools、permissions、CLI startup、session storage 或 workspace behavior 的迭代，都应在相关时更新 config tests。

## 15. 验收标准

MVP configuration system 成功标准：

- 非敏感设置可以从用户配置和项目配置加载。
- Secrets 从环境变量加载。
- Effective config 具有确定性优先级。
- 无效配置会产生可理解错误。
- CLI 可以展示生效的非 secret 配置。
- Raw secrets 不会出现在 trace、prompt assembly reports 或 CLI config output 中。
- Agent Core 接收 configured dependencies，而不是自己加载配置。
- Configuration behavior 有 unit 和 integration tests 覆盖。

## 16. 相关文档

- [Main design](../product/peewit-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [CLI Adapter](./cli-adapter.zh-CN.md)
- [Model Provider](./model-provider.zh-CN.md)
- [Permission System](./permission-system.zh-CN.md)
- [Prompt Assembly](./prompt-assembly.zh-CN.md)
- [Workspace Files](./workspace-files.zh-CN.md)
