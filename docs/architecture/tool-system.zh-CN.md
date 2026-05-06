# Tool System

状态：草案
日期：2026-05-02

English version: [tool-system.md](./tool-system.md)

## 1. 目的

Tool System 是 Peewit 让 Agent 在模型之外执行动作的机制。

模型可以生成文本，而工具让 Agent 能检查文件、运行命令、读取网页、写文档，并在未来控制浏览器或执行后台任务。

核心规则：

工具描述并执行能力。权限决定某次具体动作是否允许。

## 2. 为什么工具需要结构

没有工具系统，所有外部动作都会变成 Agent Core 里的特殊逻辑。

结构化工具系统带来：

- 统一方式向模型暴露能力
- 执行前输入校验
- 归一化工具结果
- 给权限系统使用的风险 metadata
- 可追踪执行记录
- 未来新增能力时不需要重写 Agent Core

## 3. MVP 工具

MVP 工具集：

- 文件读取
- 目录列表
- 文件写入
- Shell 命令执行
- Web 搜索
- 网页读取

延后工具：

- 浏览器自动化
- 长期记忆工具
- 后台任务工具
- 远程节点工具
- 完整沙箱代码执行

## 4. 工具职责

工具负责：

- 名称和描述
- 输入 schema
- 输出结构
- 执行实现
- 默认风险 metadata
- 结果归一化
- 工具特定错误归一化

工具不负责：

- 动作是否应该被允许
- 如何向用户请求批准
- 如何在 CLI 或 Web UI 渲染结果
- 会话历史如何存储
- 模型如何选择工具

## 5. Tool Registry

Tool Registry 是 Agent 可用工具目录。

它应支持：

- 注册工具
- 按名称查找工具
- 为 CLI 展示列出工具
- 生成模型可见的工具定义
- 生成适合 trace 的工具 metadata

Agent Core 应向 registry 查询可用工具，而不是硬编码每个工具。

## 6. 工具定义形态

实现计划阶段会细化具体类型，但工具概念可类似：

```ts
interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  risk: ToolRiskMetadata;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolResult>;
}
```

Schema 应可被机器读取，这样系统能在执行前验证模型生成的工具输入。

## 7. 工具输入校验

模型生成的工具调用在校验前都不可信。

工具执行前，系统应：

- 确认工具存在
- 根据 schema 校验输入
- 规范化路径、URL、命令字符串等
- 对格式错误输入生成清晰 trace event

无效输入应作为 observation 返回给 Agent，而不是让系统崩溃。

## 8. 工具结果形态

工具结果应归一化，便于 Agent Core 和 Trace 统一处理。

有用字段：

- `ok`：是否成功
- `summary`：短的人类可读摘要
- `data`：结构化结果数据
- `content`：相关文本内容
- `source`：相关 URL 或文件路径
- `metadata`：耗时、大小、状态码等
- `error`：失败时的归一化错误

大输出应摘要或截断后进入模型上下文，同时在 trace 中保留足够说明，让用户知道发生了什么。

## 9. 风险 Metadata

工具提供默认风险 metadata，但最终决策由 Permission System 做出。

示例：

| 工具 | 默认风险 | 说明 |
| --- | --- | --- |
| 目录列表 | Low | 仅 workspace 内为 Low |
| 文件读取 | Low | workspace 外路径或疑似 secret 文件风险更高 |
| 文件写入 | Medium | 默认需要确认 |
| Shell 命令 | High | 默认需要明确确认 |
| Web 搜索 | Low | 应记录来源 URL |
| 网页读取 | Low | 读取公开页面通常是低风险 |

风险可能依赖输入：

- 读取 workspace 内 `README.md` 是 Low。
- 读取 `.env` 默认 Blocked。
- 写入新文档可能是 Medium。
- 删除文件视范围为 High 或 Blocked。
- 运行 `rm -rf` 默认 Blocked。

## 10. 内置工具组

### 文件工具

文件工具默认应在 workspace 边界内运行。

初始工具：

- `list_directory`
- `read_file`
- `write_file`

未来工具：

- `edit_file`
- `search_files`
- `create_directory`
- `delete_file`

### Shell 工具

Shell 工具在配置的工作目录中运行命令。

初始行为：

- 默认 High risk
- 需要明确确认
- 捕获 stdout、stderr、exit code、duration
- 有超时限制
- 在 trace 中记录命令

未来行为：

- 命令 allowlist
- 已知危险命令 denylist
- 沙箱执行
- 项目级命令策略

### Web 工具

Web 工具分成：

- `web_search`
- `read_web_page`

搜索返回候选来源。网页读取获取并清理选定来源。

Agent 应在 trace 中保留 URL，方便用户检查来源。

## 11. 工具执行流程

```text
模型请求工具
  -> Agent Core 从 registry 解析工具
  -> 校验工具输入
  -> 构建 ToolAction
  -> PermissionPolicy 评估 ToolAction
  -> 如需要，Adapter 向用户请求批准
  -> 如果允许则执行工具
  -> 归一化结果
  -> 记录 trace event
  -> 把 observation 返回给 Agent Core
```

这样可以分离模型选择、权限策略、adapter 批准和工具执行。

## 12. 工具错误

工具错误应归一化并作为 observation 返回。

示例：

- 文件不存在
- OS 权限拒绝
- 路径超出 workspace
- URL 无效
- 网络超时
- 命令超时
- 命令非零退出
- 输出过大

Agent 随后可以决定重试、询问用户、选择其他工具或停止。

## 13. Workspace 边界

文件和 Shell 工具应遵守配置的 workspace 边界。

默认：

- workspace 内文件读/列目录是 Low。
- 文件写入需要确认。
- workspace 外路径风险更高。
- 疑似 secret 文件默认 Blocked。

随着 Peewit 越来越自主，这个边界会更重要。

## 14. Tool Context

工具应接收执行上下文，例如：

- Workspace root
- 当前工作目录
- Environment policy
- Timeout policy
- Trace ID
- Cancellation signal

工具不应获得整个 runtime 的无限访问权。

## 15. 扩展性

未来工具应能通过 registry 加入。

后续阶段可能引入：

- 插件提供的工具
- Skill 关联工具
- 远程节点工具
- 浏览器自动化工具
- Memory 工具
- 日历或邮件工具

每个新工具仍应遵循同样契约：

```text
描述能力
  -> 校验输入
  -> 暴露风险 metadata
  -> 通过受控上下文执行
  -> 返回归一化结果
```

## 16. 验收标准

MVP Tool System 成功标准：

- 新工具可以注册，不需要改 Agent Core。
- 工具输入执行前被校验。
- 工具结果被归一化。
- 工具调用出现在 execution trace 中。
- 执行前发生权限检查。
- 文件、Shell、Web 搜索、网页读取工具遵循同一执行流程。
- 工具特定错误作为 observation 返回，而不是让 Agent Loop 崩溃。

## 17. 相关文档

- [主设计](../product/peewit-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
- [Agent Loop](./agent-loop.zh-CN.md)
- [Model Provider](./model-provider.zh-CN.md)
- [项目结构](./project-structure.zh-CN.md)
