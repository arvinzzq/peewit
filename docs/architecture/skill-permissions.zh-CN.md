# Skill Permissions

English version: [skill-permissions.md](./skill-permissions.md)

## 1. 目的

Skill permissions 为作者提供一种声明 skill 所需系统能力的方式。用户可以在信任 skill 之前阅读这些声明。声明是建议性的 —— 它们不会自动授予或拒绝工具访问 —— 但它们使 skill 的影响面可见。

## 2. Permission 声明字段

Permissions 在 skill frontmatter 中声明，以逗号分隔字符串或 YAML 数组形式：

```yaml
# 逗号分隔形式
permissions: filesystem, shell

# YAML 数组形式
permissions:
  - filesystem
  - shell
```

已识别的 permission 值：

| 值 | 含义 |
| --- | --- |
| `filesystem` | Skill 可能会指示模型读取或写入文件。 |
| `shell` | Skill 可能会指示模型运行 shell 命令。 |
| `web` | Skill 可能会指示模型读取网页。 |
| `memory` | Skill 可能会指示模型写入长期记忆文件。 |

未知值按原样存储并展示给用户。它们不会阻止加载。

## 3. Trust 审查流程

用户安装 skill 时的 CLI 工作流：

1. `arvinclaw skills install <path>` — 复制文件，记录 `trusted: false`。
2. `arvinclaw skills review <name>` — 展示完整 metadata，包括声明的 permissions。
3. 用户阅读 permissions 和 skill 正文。
4. `arvinclaw skills trust <name>` — 在 manifest 中记录 `trusted: true`。

在 skill 被信任前，所有列表命令都会显示警告：

```
⚠ untrusted  my-skill  [filesystem, shell]
This skill was installed from an external source and has not been trusted.
Run `arvinclaw skills trust my-skill` to trust it.
```

## 4. 为何 Skill 文本是安全面

Skills 是逐字注入 system prompt 的纯文本，位于用户消息之前。模型将 skill 正文作为指令读取。恶意正文可能：

- 要求模型使用特定命令调用 `shell` 工具。
- 要求模型读取或外泄文件。
- 用相互冲突的指令覆盖安全指令。

Trust 标志表达"我已阅读此 skill 并认为其安全"。它不强制隔离或对文本进行沙箱处理。实际的工具 permission 决策仍通过 `@arvinclaw/permissions` package 进行，与 skill trust 无关。

## 5. CLI 审查命令

```
arvinclaw skills             列出所有 skills — 显示 version、trust 标志、permissions
arvinclaw skills install <path>
                             从本地 .md 文件安装 skill
arvinclaw skills enable <name>
                             启用已禁用的 skill
arvinclaw skills disable <name>
                             禁用已启用的 skill
arvinclaw skills trust <name>
                             将已安装的 skill 标记为 trusted
arvinclaw skills review <name>
                             显示完整 skill metadata 和 permission 声明
```

`review` 子命令输出：

```
Name:         my-skill
Source:       user
Version:      1.0.0
Origin:       /path/to/source.md
Permissions:  filesystem, shell
Trusted:      false
Enabled:      true
Installed:    2026-05-05T10:00:00.000Z

--- Body ---
Skill 正文文本。
```

## 6. 设计约束

- Permission 声明存储在 `SkillDefinition.permissions: string[]` 中。
- `parseSKILLMd` 接受逗号分隔和 YAML 数组两种形式。
- Manifest 中的 `trusted` 标志是 trust 状态的唯一来源。
- Workspace 和内置 skills 不出现在 manifest 中，不需要 trust 标志。
