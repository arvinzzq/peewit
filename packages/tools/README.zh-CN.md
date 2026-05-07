# Tools Package

English version: [README.md](./README.md)

## 架构概述

`@vole/tools` 负责**工具能力边界**：定义工具的存在形式、输入格式及执行方式。它不决定工具是否被允许运行——这是 `@vole/permissions` 的专属职责。

```
AgentRuntime
    │ 使用
    ▼
ExecutableTool[]    ← @vole/tools
    ├─ read_file / list_directory（低风险）
    ├─ write_file（中风险）← 创建新文件或完全替换
    ├─ edit_file（中风险） ← 精确字符串替换
    ├─ append_file（中风险）← 在文件末尾追加内容
    ├─ run_shell（高风险）
    ├─ read_web_page（低风险）
    ├─ search_files（低风险）
    ├─ update_todos / load_skill / memory_search / memory_get（低风险）
    └─ append_daily_memory（中风险）
```

## 核心概念

### 工具契约

`ToolDefinition` 携带静态元数据（name、description、inputSchema、risk），`ExecutableTool` 在此基础上增加 `execute(input, context)` 方法。`ToolExecutionContext` 携带 `workspaceRoot: string`，是注入工具执行的唯一运行时依赖。

`ToolExecutionResult` 是涵盖所有可能结果的判别联合类型，`ok: false` 的 `ToolExecutionFailure` 用于所有错误路径。

### InMemoryToolRegistry

基于 `Map<string, ToolDefinition>` 的简单注册表，所有返回值均经 `structuredClone` 防止外部修改，`list()` 按字母序排序保证确定性。

## 内置工具

### 工作区边界（read_file、list_directory、write_file）

所有基于路径的工具强制执行**工作区边界**：解析后的绝对路径必须以 `resolve(workspaceRoot)` 开头，否则返回 `path_outside_workspace` 错误。

`read_file` 和 `write_file` 还会阻止**类密钥路径**（`.env`、`.env.*`、`.netrc`、`*.key`、`*.pem`、私钥文件等）。

### Shell 工具安全层（run_shell）

三层保护：

1. **阻断命令模式**：静态正则阻断针对 `/` 或 `~` 的 `rm -r*`、fork bomb、向块设备写入、磁盘格式化工具。

2. **沙箱逃逸检测**（仅当 `sandboxed: true`）：拒绝 `/../` 路径遍历、`cd /`、`cd ~`。

3. **输出截断**：stdout 和 stderr 各最多保留 4,000 字符。

Shell 始终以 `cwd = context.workspaceRoot` 运行，默认超时 30 秒，可通过 `{ timeoutMs }` 覆盖。

### Web 工具（read_web_page）

获取 URL 内容，剥离 script/style 标签和所有 HTML 标签，解码 HTML 实体，截断至 8,000 字符。仅接受 `http:` 和 `https:` URL，`fetch` 函数可注入用于测试。

### 精确编辑工具（edit_file、append_file）

`edit_file` 在现有文件中替换精确的字符串——模型不会意外破坏周围的代码。输入：

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `path` | `string` | 是 | — |
| `old_string` | `string` | 是 | — |
| `new_string` | `string` | 是 | — |
| `replace_all` | `boolean` | 否 | `false` |

若 `old_string` 不存在返回 `string_not_found`；若出现多次且未设 `replace_all` 返回 `multiple_matches`。

`append_file` 在不修改现有内容的前提下，向文件末尾添加内容，文件和父目录不存在时自动创建。

**何时选用：**
- `edit_file` — 修改现有代码、配置、测试用例
- `append_file` — 添加新的 describe 块、新条目、日志
- `write_file` — 创建新文件或有意替换全部内容

### 搜索工具（search_files）

在工作区文件中递归搜索文本或正则模式。输入：

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `pattern` | `string` | 是 | — |
| `path` | `string` | 否 | 工作区根目录 |
| `include` | `string` | 否 | 所有非二进制文件 |
| `case_sensitive` | `boolean` | 否 | `false` |
| `max_results` | `number` | 否 | `50` |

自动跳过 `node_modules`、`.git`、`dist`、`build`、`coverage` 目录和二进制文件扩展名。超过 512 KB 的文件被跳过。`include` 中的 glob 模式支持 `*`（段内匹配）、`**`（任意深度）、`?`（单字符）。返回 `SearchFilesResult`，包含 `matches[]`、`truncated`、`matchedFiles`、`searchedFiles`。

### update_todos

在接受更新前验证整个 todo 数组：每项必须有非空 content 字符串，status 必须是合法值，同一时刻最多一项为 `"in_progress"`。可选 `onUpdate` 回调在验证通过后调用。

### append_daily_memory

向 `{workspaceRoot}/memory/YYYY-MM-DD.md` 追加带时间戳的记录，自动创建 `memory/` 目录。日期可注入保证测试确定性。

### load_skill

接受 `SkillFileMap`（技能名称到文件路径的映射），读取技能文件并返回内容，允许 Adapter 在启动时注册可用技能文件。

### memory_search / memory_get

在 `memoryDir` 边界内操作：`memory_search` 对 MEMORY.md、USER.md 和 memory/*.md 执行大小写不敏感段落匹配；`memory_get` 读取特定文件，拒绝路径遍历、绝对路径和非 `.md` 扩展名。

## 实现原理

### 为何工具不决定权限

`ExecutableTool.risk` 是描述工具动作内在风险的元数据，实际的允许/询问/拒绝决定由 `@vole/permissions` 的 `PermissionPolicy` 做出，结合风险级别和当前自主模式。这使工具、权限策略、运行时三者相互独立，可分别测试和替换。

### 防御性输入处理

每个工具在使用前都验证 `input: unknown`。若必填字段缺失或类型错误，返回 `{ ok: false, error: { code: "invalid_input" } }` 而非抛出异常，确保运行时始终收到可序列化的 `ToolExecutionResult`。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 tools 包、导出入口和构建脚本。 |
| `tsconfig.json` | TypeScript 配置 | 构建 tools 包。 |
| `src/index.ts` | 工具注册表及内置工具 | 所有导出：工具契约、`InMemoryToolRegistry`、`ToolRegistryError`、所有内置工具工厂、结果类型、`TodoItem`、`SkillFileMap`、`ShellToolOptions`。 |
| `src/index.test.ts` | 工具测试 | 覆盖所有工具执行路径、安全防护、工作区边界执行和注册表行为的完整测试套件。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。
