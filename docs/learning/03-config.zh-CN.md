# 模块 02：@vole/config

状态：已完成
日期：2026-05-07

英文版：`02-config.md`

相关源码：`packages/config/src/index.ts`

## 0. 如何使用本文档

本文档属于学习指南第三阶段（基础层模块）。
可以在任何其他模块之前或同时阅读——`loadConfig` 在每个入口点被调用，返回的 `EffectiveConfig`
贯穿整个系统。

**阅读前**：通读 `packages/config/src/index.ts`（377 行）。注意三层加载管道：`applyConfig`
（用户/项目对象）→ `applyEnv`（环境变量）→ `validateConfig`。然后看 `EffectiveConfig`——
它是整个系统所依赖的唯一类型化形态。

**聚焦问题**：
- `applyConfig` 忽略未知键。为什么这比拒绝它们更安全？
- `OPENROUTER_API_KEY` 设置 `provider`、`baseURL`，并将 `model` 重置为 `""`。然后 `validateConfig`
  拒绝空的 `model`。何时通过，何时失败？
- `RedactedConfigView` 用 `"configured" | "missing"` 替换 `secrets.apiKey`。为什么系统需要这个？
- `resolveSessionsDirectory` 展开 `~/`，但只针对以 `~/` 开头的路径。`/absolute/path` 会怎样？

**检查点**：能够完整追踪 `loadConfig({ env: { ANTHROPIC_API_KEY: "sk-..." } })` 后
`EffectiveConfig` 的每个字段值（包括调用者没有触碰的字段），即表示理解了本模块。

## 1. 这个模块做什么

**白话版**：把 config 想象成 agent 开始工作前的情况简报。运行前，有人收集规则：用哪个模型、
有多谨慎、允许哪些工具、在哪里存储 session。简报从安全默认值开始，依次被用户偏好、项目要求、
环境变量覆盖。结果是一份所有人都从中读取的干净、经验证的文档。

**技术总结**：`@vole/config` 将运行时配置加载、合并、验证并作为单一 `EffectiveConfig` 对象暴露。
它在硬编码默认值之上处理三个输入层（用户配置对象、项目配置对象、环境变量），验证结果，并返回完全
类型化的配置。还提供 `redactedConfig`（用于日志/显示的安全版本）和 `resolveSessionsDirectory`
（CLI 和 Web 共用的 `~/` 展开）。不读磁盘——调用者提供所有输入。

## 2. 为什么这个模块存在

没有中央配置包，每个模块都会直接读取 `process.env` 并自行决定默认值和验证。Bug 会分散在整个代码库中。
`@vole/config` 创建了一个单一的经验证的契约：一旦 `loadConfig` 返回，系统其余部分永远不需要再
接触 `process.env`。

这种分离也使测试成为可能——任何测试都可以用受控环境调用
`loadConfig({ env: {...} })`，而不触碰 `process.env`。

## 3. 公开接口

```ts
// 规范的运行时配置——到处传递
interface EffectiveConfig {
  model:       { provider, baseURL, model, temperature, maxTokens, thinkingBudget? }
  workspace:   { root }
  runtime:     { defaultMode, maxSteps, promptMode?, executionContract?, toolProfile?, sandboxed? }
  trace:       { verbosity }
  tools:       { fileSystem, shell, web }
  permissions: { allowLowRisk }
  sessions:    { directory }
  memory:      { longTermFiles, writes }
  secrets:     { apiKey }       // ← 包含真实密钥
}

// 安全用于日志/显示——隐藏实际密钥
interface RedactedConfigView extends Omit<EffectiveConfig, "secrets"> {
  secrets: { apiKey: "configured" | "missing" }
}

// 入口点——所有输入可选
function loadConfig(input?: LoadConfigInput): EffectiveConfig

// 用安全显示值替换 secrets
function redactedConfig(config: EffectiveConfig): RedactedConfigView

// 使用 env 或 process.env 中的 HOME 展开 sessions.directory 中的 ~/
function resolveSessionsDirectory(
  config: EffectiveConfig,
  env?: Record<string, string | undefined>
): string
```

## 4. 实现走读

### 三层合并管道

```ts
export function loadConfig(input: LoadConfigInput = {}): EffectiveConfig {
  const config = cloneConfig(defaultConfig);   // 1. 从默认值开始
  applyConfig(config, input.userConfig);        // 2. 用户偏好
  applyConfig(config, input.projectConfig);     // 3. 项目覆盖
  applyEnv(config, input.env ?? {});            // 4. 环境变量
  validateConfig(config);                       // 5. 拒绝无效结果
  return config;
}
```

每层都是累加的：后层覆盖前层的同一字段。管道总是从 `defaultConfig` 的新鲜克隆开始——跨调用的
共享可变状态是不可能的。

### applyConfig：宽容合并

```ts
function applyObject(target: Record<string, unknown>, value: unknown): void {
  for (const [key, sectionValue] of Object.entries(value)) {
    if (key in target) {           // 只应用已知键
      target[key] = sectionValue;  // 未知键静默忽略
    }
  }
}
```

未知键被静默忽略而非拒绝。这是有意为之：为新版 Vole（有额外字段）编写的配置文件不应该破坏旧版本。
已知字段的调用者意图仍然被应用；额外字段被丢弃。

### applyEnv：通过键存在检测 provider

```ts
function applyEnv(config, env) {
  if (env.OPENROUTER_API_KEY !== undefined) {
    config.model.provider = "openai-compatible";
    config.model.baseURL = "https://openrouter.ai/api/v1";
    config.model.model = "";         // ← 有意清空
    config.secrets.apiKey = env.OPENROUTER_API_KEY;
  }
  if (env.ANTHROPIC_API_KEY !== undefined) {
    config.model.provider = "anthropic";
    config.model.model = "claude-haiku-4-5-20251001";   // ← 设置默认值
    config.secrets.apiKey = env.ANTHROPIC_API_KEY;
  }
  // ...
  if (env.VOLE_API_KEY !== undefined) {
    config.secrets.apiKey = env.VOLE_API_KEY;  // ← 通用覆盖
  }
}
```

`OPENROUTER_API_KEY` 将 model 清空为 `""`，因为 OpenRouter 需要明确的模型名称（如 `openai/gpt-4o`）。
`validateConfig` 随后会拒绝空模型字符串——除非同时设置了 `VOLE_MODEL`。`ANTHROPIC_API_KEY` 设置了
默认模型，所以基本使用不需要额外的环境变量。

**优先级顺序**：`OPENROUTER_API_KEY` → `ANTHROPIC_API_KEY` → `VOLE_API_KEY`。`applyEnv` 中
靠后的环境变量覆盖靠前的，所以 `VOLE_API_KEY` 是不管 provider 都能用的通用密钥。

### validateConfig：全有或全无

验证在所有层合并后运行。如果任何字段有无效值，抛出 `ConfigValidationError`，配置被丢弃。
最常见的失败是设置了 `OPENROUTER_API_KEY` 但没有 `VOLE_MODEL`：

```
"No model configured. Set VOLE_MODEL=<model-name>"
```

验证对枚举字段（provider、mode、verbosity）严格，对可选字段宽容——只在字段存在时才验证。

### RedactedConfigView：安全显示

```ts
export function redactedConfig(config: EffectiveConfig): RedactedConfigView {
  return {
    ...config,
    secrets: {
      apiKey: config.secrets.apiKey === undefined ? "missing" : "configured"
    }
  };
}
```

CLI 在打印配置输出（`vole config`）时使用 `redactedConfig`。没有这个，`console.log(config)` 会把
API 密钥泄露到终端日志、CI 输出或崩溃报告中。类型系统强制了这种分离：`RedactedConfigView.secrets.apiKey`
是 `"configured" | "missing"`，所以不可能意外地把脱敏视图当成包含真实密钥来使用。

### resolveSessionsDirectory：共享 ~ 展开

```ts
export function resolveSessionsDirectory(config, env?) {
  const directory = config.sessions.directory;
  if (!directory.startsWith("~/")) return directory;
  const home = env?.HOME ?? process.env.HOME;
  return home === undefined ? directory : join(home, directory.slice(2));
}
```

默认 sessions 目录是 `~/.vole/sessions`。CLI 和 Web 都调用这个辅助函数，无论各自如何启动，都始终
解析到同一个绝对路径。`env` 参数可注入用于测试——测试可以模拟任何 `HOME` 而不用修改 `process.env`。

注意：当 CLI 适配器检测到 git 仓库时，会进一步覆盖 `sessions.directory`：将 sessions 存储在
`<git-root>/.vole/sessions/` 而非全局默认路径。这一覆盖发生在适配器调用 `loadConfig` 之前，
因此 `resolveSessionsDirectory` 看到的已经是最终选定的路径。

## 5. OpenClaw 对齐

| OpenClaw | Vole | 说明 |
|---|---|---|
| 分层配置（默认 → 用户 → 项目 → 环境） | `loadConfig` 管道 | 相同顺序 |
| 单一经验证的配置对象到处传递 | `EffectiveConfig` | 相同模式 |
| 用于显示的脱敏配置 | `RedactedConfigView` + `redactedConfig()` | 相同概念 |
| 路径 `~` 展开 | `resolveSessionsDirectory` | 相同工具模式 |
| 环境变量作为主要配置机制 | `applyEnv` 加 `VOLE_*` 变量 | 相同方式 |

## 6. 关键设计决策

**不读磁盘——调用者提供所有输入**

`loadConfig` 接受 `userConfig`、`projectConfig`、`env` 作为参数，而非自己读文件。CLI 适配器在启动时
读取配置文件并将解析后的对象传入；`loadConfig` 只负责合并。具体来说，CLI 在调用
`loadConfig({ userConfig, projectConfig, env: process.env })` 之前，会自动读取
`~/.vole/config.json`（用户配置）和项目根目录下的 `vole.config.json`（项目配置）。这使包无需文件系统
mock 即可测试，并且不含文件路径假设。

**宽容合并，严格验证**

`applyConfig` 忽略未知键（向前兼容）。`validateConfig` 对已知字段严格（对拼写错误立即反馈）。
合在一起：旧配置在新代码上有效，但无效值快速失败并有清晰错误。

**`secrets` 节在类型中隔离**

API 密钥存在 `config.secrets.apiKey` 中。其他配置是惰性数据。这使得可以把 `config.model`、
`config.runtime` 等传给子系统而不会意外传递密钥。`RedactedConfigView` 在类型层面强制了这种分离——
显示版本不可能意外泄露 secret。

**`OPENROUTER_API_KEY` 将 model 重置为 `""`**

这是有意的"强制你选择模型"设计。OpenRouter 支持数百个模型，没有合理的默认值。清空模型字符串并让
`validateConfig` 用有用的消息失败，比猜测更清晰。

## 7. 测试方式

测试在 `packages/config/src/index.test.ts` 中（335 行）。所有测试使用依赖注入——不读真实的
`process.env`：

- 默认值：验证每个 `EffectiveConfig` 字段的基线
- 层优先级：用户配置 → 项目配置 → 环境，各层依次覆盖
- Provider 快捷方式：`OPENROUTER_API_KEY`、`ANTHROPIC_API_KEY`、`VOLE_API_KEY` 交互
- 各个环境变量：`VOLE_MODEL`、`VOLE_DEFAULT_MODE`、`VOLE_WORKSPACE_ROOT` 等
- 验证失败：无效枚举、空 model、不支持的 memory.writes
- `redactedConfig`：API 密钥隐藏，其他字段保留
- `resolveSessionsDirectory`：绝对路径不变，`~/` 用 env HOME 展开，回退处理

## 8. 洞察

**`EffectiveConfig` 是系统的共享词汇。** 每个 adapter、每个工具、每个运行时决策都从这个对象开始。
在这里修改字段名或类型需要更新整个代码库。Config 包是 monorepo 中最核心的依赖。

**管道顺序比各步骤本身更重要。** `applyEnv` 总是最后运行（在验证之前），所以环境变量总是胜过配置文件。
这是标准的"12 因素应用"惯例——环境是部署时覆盖，配置文件是代码时默认值。

**`memory.writes` 始终是 `"disabled"`。** 验证拒绝任何其他值：
```
"Invalid memory.writes "...". Only disabled is supported."
```
这是还未完全设计的未来写入策略的占位符。与其静默忽略字段，不如大声失败以防止困惑。

**包中没有 `process.env`。** `applyEnv` 接受 `Record<string, string | undefined>` 参数。
`process.env` 出现的唯一位置是 `resolveSessionsDirectory` 中作为 `HOME` 的回退。
这使包完全可测试且可移植。

**基于文件的配置加载在适配器中，而不在包中。** CLI 在调用 `loadConfig` 之前读取
`~/.vole/config.json` 和 `vole.config.json`。这些文件遵循与 `EffectiveConfig` 各节相同的结构——
它们是普通 JSON 对象，键由 `applyConfig` 合并。如果文件不存在，适配器对该参数传入 `undefined`，
`applyConfig` 会忽略它。优先级链因此为：环境变量 > `vole.config.json` > `~/.vole/config.json` >
默认值。

## 9. 复习问题

1. 如果配置文件设置了 `model.unknownField = "value"` 会怎样？
   > `applyObject` 只应用目标对象中存在的键（`if (key in target)`）。未知键被静默丢弃。
   > 配置不会被拒绝——这是为新版 Vole 编写的配置文件的向前兼容性。

2. 设置了 `OPENROUTER_API_KEY` 但没有 `VOLE_MODEL`，会发生什么？
   > `applyEnv` 看到 `OPENROUTER_API_KEY` 时将 `config.model.model = ""`。然后 `validateConfig`
   > 检查 `config.model.model.trim().length === 0` 并抛出
   > `ConfigValidationError("No model configured. Set VOLE_MODEL=...")`。

3. 同时设置了 `OPENROUTER_API_KEY` 和 `ANTHROPIC_API_KEY`，哪个 provider 胜出？
   > `ANTHROPIC_API_KEY` 胜出。`applyEnv` 先处理 `OPENROUTER_API_KEY`，然后 `ANTHROPIC_API_KEY`
   > 覆盖 `provider`、`model` 和 `apiKey`。后写入的胜出。如果还设置了 `VOLE_API_KEY`，
   > 它只覆盖 `apiKey`，provider 保持最后运行的那个密钥的值。

4. 为什么 `redactedConfig` 作为函数存在，而不是直接省略 `secrets`？
   > 完全省略 `secrets` 会让人明显感觉缺少了什么，但调用者可能仍需要知道密钥是否已配置（在 UI
   > 中显示"API 密钥：已配置"vs"API 密钥：缺失"）。`redactedConfig` 保留了存在信号同时删除了
   > 实际值。返回类型是 `RedactedConfigView`——类型层面的强制，确保显示版本永远不能用来提取真实密钥。

5. CLI 和 Web 都调用 `resolveSessionsDirectory`。为什么它在 `@vole/config` 而不是各个 adapter 中？
   > 两个 adapter 需要解析到相同路径，以确保 CLI 创建的 session 在 Web UI 中可见，反之亦然。
   > 集中解析逻辑防止了漂移——如果某个 adapter 改变了展开 `~/` 的方式，sessions 目录就会分叉，
   > session 会看似丢失。

6. CLI 自动加载 `~/.vole/config.json` 和 `vole.config.json`。为什么 `loadConfig` 不自己读这些文件？
   > `loadConfig` 刻意不做 I/O，以便无需文件系统 mock 即可测试，并且可在不适用这些路径的环境（如
   > 浏览器/Web 适配器）中使用。读文件是适配器的职责：适配器读取文件、解析，并将普通对象作为
   > `userConfig`/`projectConfig` 传入。这让 `@vole/config` 保持为纯转换包——它验证并合并；
   > 从不读磁盘。
