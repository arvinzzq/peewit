# Plugin System

English version: [plugin-system.md](./plugin-system.md)

> **Phase 16 更新**：不可信 skill（未 `vole skills trust` 标记的）通过 `@vole/permissions` 的 `WorkerThreadSandbox` 执行，不再 inline 跑 —— 第三方 skill 抛错或撑爆内存不再拖垮主进程。已信任 skill 继续 inline 运行。见 [Phase 16 计划](../plans/phase-16-sandbox-and-plugin-runtime.zh-CN.md)。worker-thread 隔离层推迟到 Phase 16b。

## 1. 目的

Plugin system 为用户提供一种受管理的方式来安装、启用、禁用和检查非 Vole 内置的 skills。它记录来源、版本和 trust 状态，以便用户随时了解某个 skill 的来源及是否已审查。

## 2. 范围

Phase 9 仅覆盖本地文件安装。从 URL 远程安装、签名验证和 public marketplace 均为本阶段的非目标。

## 3. Plugin Metadata 格式

每个已安装的 skill 是一个带有 YAML frontmatter 的 Markdown 文件（`*.md`）。Frontmatter 支持以下字段：

```yaml
---
name: my-skill
description: 该 skill 的作用及调用时机。
version: 1.0.0
origin: /path/to/source.md
permissions: filesystem, shell
---
注入 system prompt 的 skill 正文文本。
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | Skill 的唯一标识符。 |
| `description` | 是 | 人类可读的用途和调用提示。 |
| `version` | 否 | Semver 或自由格式版本字符串。 |
| `origin` | 否 | Skill 安装来源的 URL 或本地路径。 |
| `permissions` | 否 | 声明的能力要求，以逗号分隔或 YAML 数组形式。 |

## 4. 安装路径

用户安装的 skills 存储于：

```
~/.vole/skills/<name>.md
```

这是 sessions 目录（`~/.vole/sessions/`）的同级目录。

Workspace skills 存储于 `<workspaceRoot>/skills/<name>/SKILL.md`，始终受信任。内置 skills 嵌入在 `@vole/skills` package 二进制中。

## 5. Manifest 文件

Manifest 追踪已安装的用户 skills 及其生命周期状态：

```
~/.vole/skills/skills-index.json
```

示例内容：

```json
{
  "skills": [
    {
      "name": "my-skill",
      "filePath": "/Users/arvin/.vole/skills/my-skill.md",
      "installedAt": "2026-05-05T10:00:00.000Z",
      "origin": "/path/to/source.md",
      "trusted": false,
      "enabled": true
    }
  ]
}
```

Manifest 是 `enabled` 和 `trusted` 状态的唯一来源。当 manifest 缺失时，`SkillLoader` 继续运行（无已安装 skills）。

## 6. Trust 模型

Skills 是注入 system prompt 的纯文本。它们不能直接执行代码，但恶意的 skill 正文可能尝试 prompt injection —— 指示模型调用危险工具或泄露敏感上下文。

Trust 模型提供可见性和控制：

- **Workspace skills** 始终受信任（已检入项目仓库）。
- **内置 skills** 始终受信任（随 package 发布）。
- **用户安装的 skills** 初始为 `trusted: false`。
- `trusted: false` 的 skill 仍会加载（为了可用性），但 CLI 会显示明显警告。
- 用户通过 `vole skills trust <name>` 明确信任 skill。

`trusted` 标志不授予额外能力；它只是抑制警告。

## 7. 生命周期

```
install → (trusted: false, enabled: true)
  ↓
review (vole skills review <name>)
  ↓
trust (vole skills trust <name>) → trusted: true
  ↓
disable (vole skills disable <name>) → enabled: false
  ↓
enable (vole skills enable <name>) → enabled: true
```

## 8. SkillManager API

```ts
class SkillManager {
  constructor(skillsDirectory: string)

  async loadManifest(): Promise<SkillManifest>
  async saveManifest(manifest: SkillManifest): Promise<void>

  async install(sourcePath: string): Promise<SkillManifestEntry>
  async enable(name: string): Promise<void>
  async disable(name: string): Promise<void>
  async trust(name: string): Promise<void>
  async review(name: string): Promise<SkillDefinition | undefined>

  async listEntries(): Promise<SkillManifestEntry[]>
}
```

`install` 将 `.md` 文件复制到 `{skillsDirectory}/{name}.md`，并添加 manifest entry。若同名 skill 已存在，则文件被覆盖，`installedAt` 被更新。

## 9. 优先级规则

加载顺序（由高到低）：

1. Workspace skills（`<root>/skills/<name>/SKILL.md`）
2. 用户安装的 skills（`~/.vole/skills/<name>.md`）
3. 内置 skills

已禁用的用户 skills 被完全跳过。若用户 skill 与内置 skill 同名，用户 skill 优先（需通过 disabled 检查）。
