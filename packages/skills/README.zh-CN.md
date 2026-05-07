# Skills Package

English version: [README.md](./README.md)

## 架构概述

`@vole/skills` 负责**技能发现、解析和生命周期管理**。技能是可复用的 Agent 指令文件（含 YAML frontmatter 的 `.md` 文件），Agent 可按需加载。该包提供用于发现的 `SkillLoader`、用于用户生命周期操作（安装、启用、禁用、信任）的 `SkillManager`，以及 SKILL.md 文件的 `parseSKILLMd` 解析器。

```
技能来源（3 层，优先级顺序）：
  1. workspace/skills/*/SKILL.md    ← 项目特定覆盖（最高优先级）
  2. ~/.vole/skills/*.md        ← 用户安装技能（manifest 控制）
  3. 内置（硬编码）                  ← research、project-inspector、safe-shell

        SkillLoader.load()
              │
              ▼
    SkillDefinition[]   →  toSkillSummary()  →  ContextSkillSummary[]
    （完整信息，供 CLI）    （紧凑，供 context 注入）
```

## 核心概念

### SKILL.md 格式

含 YAML frontmatter 的 Markdown 文件：

```markdown
---
name: my-skill
description: 用作 context 注入触发器的简短描述。
version: 1.0.0
origin: https://example.com/skills/my-skill.md
permissions: read_file, list_directory
---

完整技能指令在此。Agent 需要遵循技能详细指导时，
通过 `load_skill` 工具加载此 body。
```

必填字段：`name`、`description`。可选：`version`、`origin`、`permissions`（逗号分隔或 YAML 数组）。

### SkillDefinition 与 SkillSummary

`SkillDefinition` 携带完整技能元数据（body、filePath、trusted、enabled、version、origin、permissions），供 CLI（`vole skill list`、`vole skill review`）使用。

`SkillSummary` 是注入到 context 提示 `<skills>` section 的紧凑投影（name、description、source）。Agent 只看到技能名称和描述——通过 `load_skill` 工具按需加载完整 body。

### 技能来源与优先级

`SkillLoader.load()` 应用先到先得的去重策略：

1. **工作区技能**（`{workspaceRoot}/skills/*/SKILL.md`）— 最高优先级，每个子目录是一个含 `SKILL.md` 的技能。
2. **用户技能**（`~/.vole/skills/*.md`）— 扁平的 `.md` 文件，通过 `skills-index.json` manifest 追踪。未在 manifest 中或 `enabled: false` 的技能被跳过。
3. **内置技能** — 在源码中硬编码：`research`、`project-inspector`、`safe-shell`。

工作区技能和用户技能同名时，工作区技能优先（其条目先被加入 `seen` 集合）。

### SkillManifest

```typescript
interface SkillManifest {
  skills: SkillManifestEntry[];
}

interface SkillManifestEntry {
  name: string;
  filePath: string;
  installedAt: string;
  origin?: string;
  trusted: boolean;   // true = 已信任的第三方技能
  enabled: boolean;   // false = 加载时跳过
}
```

Manifest 文件位于 `~/.vole/skills/skills-index.json`，由 `SkillLoader` 读取用于过滤用户技能，由 `SkillManager` 执行生命周期操作时写入。

### 内置技能

三个内置技能始终可用、始终受信任、不可禁用：

| 名称 | 用途 |
|---|---|
| `research` | 网络搜索、信息源比较、引用感知输出 |
| `project-inspector` | 代码库结构检查和模块职责摘要 |
| `safe-shell` | Shell 命令风险评估和更安全的执行指导 |

内置技能的 `filePath` 为空字符串（硬编码，无对应文件）。

## 实现原理

### SkillLoader：错误容错

技能加载过程中所有文件系统错误均静默捕获并跳过。缺失的 `skills/` 目录、格式错误的 SKILL.md 或不可读文件不会导致加载失败——技能简单地缺席于结果中。这防止单个损坏的技能文件导致 Agent 启动崩溃。

### parseSKILLMd：YAML 子集解析器

解析器实现最小 YAML 子集，无需 YAML 库依赖：

1. 查找 `---` 开头和结尾分隔符。
2. 解析 `key: value` 行，构建扁平的 `fields` 记录。
3. 处理 YAML 列表语法（`  - item`）用于 `permissions` 等数组字段。
4. 支持逗号分隔的 `permissions: a, b, c` 格式。
5. 若 `name` 或 `description` 字段缺失则返回 `null`。

### SkillManager：生命周期操作

`SkillManager` 用加载-修改-保存模式包装 manifest 文件：

- `install(sourcePath)` — 复制源文件到技能目录，解析名称，以 `trusted: false, enabled: true` 插入/更新 manifest 条目。
- `enable(name)` / `disable(name)` — 加载 manifest，找到条目，设置 `enabled`，保存。
- `trust(name)` — 加载 manifest，找到条目，设置 `trusted: true`，保存。
- `review(name)` — 加载技能文件，返回完整 `SkillDefinition` 供信任前检查。

所有操作在 manifest 中找不到技能名称时抛出异常。

### 可注入文件系统操作

`SkillLoader` 和 `SkillManager` 均接受可注入的 `readDir` 和 `readFile` 函数（在 `SkillLoaderOptions` 中），允许测试提供进程内文件系统而不触及真实文件系统。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 skills 包（不依赖其他工作区包）。 |
| `tsconfig.json` | TypeScript 配置 | 构建 skills 包。 |
| `src/index.ts` | 技能系统 | 所有导出：`SkillDefinition`、`SkillSummary`、`SkillManifest`、`SkillManifestEntry`、`SkillSource`、`SkillLoader`、`SkillManager`、`parseSKILLMd`、`toSkillSummary`。 |
| `src/index.test.ts` | 技能测试 | 保护 SKILL.md 解析、优先级加载、manifest 过滤、SkillManager 生命周期、错误容错和摘要投影。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。
