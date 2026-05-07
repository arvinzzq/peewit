# 模块 09：@vole/skills

状态：已完成
日期：2026-05-07

英文版本：`10-skills.md`

相关源码：`packages/skills/src/index.ts`

## 0. 如何使用本文档

本文档属于[学习指南](./guide.zh-CN.md)第三阶段（基础模块）的一部分。
请在阅读 [07-context.zh-CN.md](./07-context.zh-CN.md) 之后阅读本文档——系统提示中的 `<skills>` 区段由 `SkillSummary[]` 构建，而这些摘要正是由本模块提供的。

**阅读前**：完整阅读 `packages/skills/src/index.ts`。注意有两个不同的类：`SkillLoader`（只读发现）和 `SkillManager`（写入路径的生命周期管理）。

**重点问题**：
- `SkillDefinition` 和 `SkillSummary` 有什么区别？为什么上下文组装只接收 `SkillSummary`？
- 存在三个来源。如果 workspace 和 user 都有名为 `research` 的技能，哪个胜出？追踪具体的代码路径。
- 为什么 `@vole/skills` 没有外部依赖？`parseSKILLMd` 做了什么？
- `trusted` 是 `SkillDefinition` 上的字段，但 `SkillLoader` 不强制执行它。谁来执行？

**检查点**：当你能描述从磁盘上的 `SKILL.md` 文件到 `<skills>` 系统提示区段中一行条目的完整旅程，并解释为什么 body 不包含在内时，说明你理解了本模块。

## 1. 通俗易懂：这个模块做什么

**打个比方**：技能就像抽屉里的菜谱卡片。Agent 始终有一个抽屉索引——卡片名称和一行描述的列表。当 agent 决定需要遵循某个菜谱时，它取出那张卡片阅读完整说明。Agent 不会一次性读所有卡片，只取需要的那张。技能的工作方式相同：系统提示包含紧凑的索引，完整指令按需加载。

**技术概要**：`@vole/skills` 发现、解析和管理可复用的 agent 指令文件（`SKILL.md`）。它提供用于从三个来源（工作区、用户、内置）读取技能文件的 `SkillLoader`，用于用户操作（安装、启用、禁用、信任）的 `SkillManager`，以及用于解析 SKILL.md frontmatter 的 `parseSKILLMd`。该包暴露用于紧凑上下文注入的 `SkillSummary` 和用于 CLI 完整元数据访问的 `SkillDefinition`。

## 2. 为什么需要它

没有技能，agent 的行为只能由系统指令引导——一个静态文本块。技能增加了第二层：可复用、可组合的指令集，agent 可以有选择地应用于当前任务。

技能还解决了 token 预算问题。一个工作区可能有几十个技能。如果每个技能的完整 body 都注入到每个 prompt 中，无论是否相关，token 成本会随技能数量线性增长。索引-然后-加载的设计将每轮成本固定在每个技能约 20 token（索引中），只有显式触发时才出现完整 body。

## 3. 公共接口

```ts
// 包含所有元数据的完整解析技能
interface SkillDefinition {
  name: string
  description: string
  body: string           // 完整指令——默认不注入 context
  source: SkillSource    // "built-in" | "user" | "workspace"
  filePath: string
  version?: string
  origin?: string        // 技能下载来源 URL
  permissions?: string[] // 声明的权限（如 ["filesystem", "shell"]）
  trusted?: boolean      // 仅用户技能：显式信任后为 true
  enabled?: boolean      // 仅用户技能：false = 加载时跳过
}

// 注入 <skills> context 区段的紧凑投影
interface SkillSummary {
  name: string
  description: string
  source: SkillSource
}

// 发现
class SkillLoader {
  load(options?: SkillLoaderOptions): Promise<SkillDefinition[]>
}

// 生命周期管理（仅用户技能）
class SkillManager {
  install(sourcePath: string): Promise<SkillManifestEntry>
  enable(name: string): Promise<void>
  disable(name: string): Promise<void>
  trust(name: string): Promise<void>
  review(name: string): Promise<SkillDefinition | undefined>
  listEntries(): Promise<SkillManifestEntry[]>
}

// 工具函数
function parseSKILLMd(content: string): { name, description, body, ... } | null
function toSkillSummary(skill: SkillDefinition): SkillSummary
```

## 4. 实现详解

### SKILL.md 格式

每个技能都是一个含 YAML frontmatter 的 Markdown 文件：

```markdown
---
name: research
description: Use when investigating external information or comparing sources.
version: 1.0.0
origin: https://example.com/skills/research.md
permissions: filesystem
---

搜索相关来源，阅读并比较至少两个，并附带来源链接汇总发现。
优先选择第一手资料。标记相互矛盾的证据。
```

`name` 和 `description` 是必填项。第一对 `---` 之间的所有内容是元数据；之后的内容是 `body`。

### 三来源加载与优先级

`SkillLoader.load()` 按顺序从三个来源加载，使用先到先得的 `Set`：

```ts
const seen = new Set<string>();
const add = (skill) => {
  if (!seen.has(skill.name)) { seen.add(skill.name); skills.push(skill); }
};

// 1. 工作区——最高优先级
for (const skill of workspaceSkills) add(skill);

// 2. 用户——覆盖内置，但不覆盖工作区
for (const skill of userSkills) add(skill);

// 3. 内置——最低优先级
for (const skill of BUILTIN_SKILLS) add(skill);
```

工作区的 `research` 技能会阻止用户和内置的 `research` 被加载。Agent 对每个名称只会看到一个技能。

### 文件结构：两个来源都用子目录

工作区和用户技能都使用相同的 `<name>/SKILL.md` 布局：

```
工作区:  ./skills/research/SKILL.md
用户:    ~/.vole/skills/research/SKILL.md
```

这让每个技能可以在 `SKILL.md` 旁边放置附属文件（模板、示例）。`SkillManager.install()` 创建子目录并将源文件复制为 `SKILL.md`。

### 用户技能 manifest

用户技能有一个 `skills-index.json` manifest，位于 `~/.vole/skills/skills-index.json`：

```json
{
  "skills": [
    {
      "name": "research",
      "filePath": "~/.vole/skills/research/SKILL.md",
      "installedAt": "2026-05-07T10:00:00Z",
      "origin": "https://example.com/skills/research.md",
      "trusted": false,
      "enabled": true
    }
  ]
}
```

`SkillLoader` 读取此 manifest 以跳过 `enabled: false` 的技能。`SkillManager` 在执行生命周期操作时写入它。

### 从 SkillDefinition 到 SkillSummary

在运行时，CLI 将 `SkillDefinition[]` 映射为 `SkillSummary[]` 后传给 `ContextAssembler`：

```ts
const skillIndex = skillDefinitions.map(toSkillSummary);
// toSkillSummary 丢弃：body、filePath、trusted、enabled、version、origin、permissions
// 保留：name、description、source
```

组装后的 `<skills>` 区段如下：

```
<skills>
- research: Use when investigating external information or comparing sources.
- safe-shell: Use when planning to run shell commands, especially destructive ones.
</skills>
```

模型读取这个索引，判断是否需要某个技能，然后调用 `load_skill("research")` 获取完整 body。Body 注入只在触发时发生。

## 5. OpenClaw 对照

| OpenClaw | Vole | 说明 |
|---|---|---|
| 从工作区 + 用户 + 内置发现技能 | `SkillLoader.load()` | 相同的三来源模型 |
| 系统提示中的紧凑技能索引 | `SkillSummary[]` → `<skills>` 区段 | 相同的渐进式披露 |
| 按需加载 body 的 `load_skill` 工具 | `@vole/tools` 中的 `load_skill` 工具 | 完全相同的概念 |
| 第三方技能的 trust 控制 | `trusted` 字段 + CLI 执行 | OpenClaw 有更丰富的权限模型 |
| 用户生命周期的技能 manifest | `skills-index.json` | 相同模式 |

## 6. 关键设计决策

**渐进式披露：先索引，按需加载 body**

系统提示每个技能只包含 `name` 和 `description`（约 20 token）。完整 body（每个技能可能几千 token）默认不在初始 context 中。当模型调用 `load_skill("research")` 时，body 仅注入当前轮次。

没有这个设计，有 20 个技能的工作区每次 prompt 都会多花几千 token，无论是否相关。渐进式披露让每轮成本与技能数量无关。

**先到先得的去重**

三次加载（工作区 → 用户 → 内置）使用单个 `seen` Set。第一次 `add()` 胜出；后续同名调用静默丢弃。这比合并语义更简单（不需要决定哪些字段优先），并给了工作区技能明确的覆盖权力。

**`trusted` 是元数据，不是约束**

`SkillLoader` 记录新安装用户技能的 `trusted: false` 并在 `SkillDefinition` 中暴露它，但不做任何强制。Trust 检查在 CLI 适配器中——它决定在运行具有提升权限的技能引导操作之前是否提示用户。这个分离让 skills 包不含权限策略，在不同信任模型的场景中可复用。

**没有外部依赖，手写解析器**

`@vole/skills` 没有 workspace 包依赖也没有第三方依赖。`parseSKILLMd` 是自定义的 YAML 子集解析器，处理 SKILL.md 文件实际需要的少量构造：`key: value`、`  - item` 数组和 `---` 分隔符。完整 YAML 库会增加安全攻击面和依赖体积，没有实际收益。

**`SkillLoader` vs `SkillManager`——读 vs 写路径**

`SkillLoader` 是只读的：发现并解析技能文件，从不写任何内容，每次 `runTurn` 都会调用。`SkillManager` 是写入路径：创建目录、复制文件、更新 manifest，由 CLI 技能管理命令调用。两个类从不共享状态。

## 7. 测试方式

测试在 `packages/skills/src/index.test.ts` 中。`SkillLoader` 测试使用可注入的 `readDir` 和 `readFile` 函数——不需要真实文件系统。`SkillManager` 测试使用真实临时目录。

测试类别：
- `parseSKILLMd`：有效 frontmatter、缺少分隔符、缺少必填字段、可选字段（version、origin、permissions 逗号分隔和 YAML 数组）
- `SkillLoader`：内置兜底、工作区加载、工作区覆盖内置、用户技能加载、工作区覆盖用户、缺少目录优雅跳过、不可读文件静默跳过、通过 manifest 跳过禁用技能、默认不信任
- `SkillManager`：安装创建子目录和 manifest 条目、安装含扩展字段、enable/disable 设置 manifest 标志、trust 设置 trusted 标志、review 返回完整定义、listEntries 返回 manifest 条目、未知名称时抛出错误

## 8. 深入洞察

**`<skills>` 区段是路由表，不是知识库。** 每条条目都是触发条件（"Use when..."），帮助模型决定是否加载该技能。好的描述回答的是"我应该何时取出这张卡片"，而不是"这个技能做什么"。这就是为什么 CLAUDE.md 技能编写规范要求描述包含 use-when 和 skip-when 条件。

**技能无需编排即可组合。** 模型可以在单轮内通过多次调用 `load_skill` 依次加载多个技能。没有编排器决定组合哪些技能——模型读取索引并根据当前任务自行决定。

**工作区技能是主要的定制点。** 内置技能是通用兜底；用户技能是个人偏好；工作区技能是项目特定覆盖，确保团队中每个成员的 agent 都遵循相同的项目规范。一个"始终先查阅内部 wiki"的工作区 `research` 技能会覆盖该工作区所有会话的通用内置技能。

**`trusted` 和 `enabled` 只适用于用户技能——这是有意为之的。** 工作区技能在版本控制中：合并前经过审查，历史可见，只能由有写权限的人更改。内置技能是代码库的一部分。只有用户安装的技能来自外部来源，需要明确的信任。对工作区或内置技能应用 trust 控制会增加摩擦而不解决真实威胁。

## 9. 复习问题

1. `SkillDefinition` 和 `SkillSummary` 有什么区别？为什么 `ContextAssembler` 接收 `SkillSummary[]` 而不是 `SkillDefinition[]`？
   > `SkillDefinition` 包含完整技能信息（body、filePath、trusted、enabled、version、origin、permissions）。`SkillSummary` 是只有 `name`、`description` 和 `source` 的紧凑投影。`ContextAssembler` 接收 `SkillSummary[]`，因为 body 不能在初始 context 中——它通过 `load_skill` 按需加载。注入所有 body 会使每次 prompt 多花几千 token，无论是否相关。

2. 工作区和用户都有名为 `research` 的技能，模型看到哪个？追踪代码路径。
   > 工作区版本胜出。`SkillLoader.load()` 先对工作区技能调用 `add()`，将 `"research"` 加入 `seen` Set。处理用户技能时，`add()` 发现 `"research"` 已在 `seen` 中并跳过。模型的 `<skills>` 索引包含工作区的描述。

3. 为什么 `@vole/skills` 没有外部依赖？`parseSKILLMd` 处理什么？
   > 没有外部依赖让包保持轻量，没有安全攻击面。`parseSKILLMd` 实现了最小 YAML 子集：`---` 分隔符、`key: value` 行、`  - item` 数组语法，以及 `name`/`description` 校验。完整 YAML 解析对 SKILL.md 文件实际包含的内容是不必要的。

4. `SkillDefinition` 上有 `trusted: false`。`SkillLoader` 会拒绝加载它吗？
   > 不会。`SkillLoader` 从 manifest 记录 trust 状态并在 `SkillDefinition` 中暴露，但不强制执行任何约束。`trusted: false` 的技能和其他技能一样被加载到 `SkillDefinition[]` 中。CLI 适配器负责在执行具有提升权限的技能引导操作之前检查 `trusted`。

5. `SkillLoader` 和 `SkillManager` 有什么区别？
   > `SkillLoader` 是只读的：发现技能文件、解析并返回 `SkillDefinition[]`，每轮都会调用。`SkillManager` 是写入路径：安装技能（创建子目录、复制 SKILL.md）、管理 manifest（enable、disable、trust），由 CLI 技能管理命令调用。两个类从不交互。

6. 为什么工作区和用户技能都使用 `<name>/SKILL.md` 子目录布局？
   > 子目录布局让每个技能可以在定义旁放置附属文件（模板、示例、参考数据）。扁平的单文件结构会限制每个安装的技能只能有一个文件。对两个来源使用相同布局也简化了 `#loadFromDir`——无论来源如何，加载逻辑完全相同。
