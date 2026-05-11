# Sandboxing

状态：Phase 10
日期：2026-05-11

English version: [sandboxing.md](./sandboxing.md)

## 1. 目的

本文档描述 Vole 的当前 sandbox 状态、应用于 shell 和 file tools 的限制、workspace 边界执行、被阻止命令策略，以及 Phase 10 新增内容。

## 2. 当前 Sandbox 状态

Vole 的 sandbox 通过 `packages/tools` 中的 tool 级别守卫实现。没有 OS 级别的进程隔离。Sandbox 是在任何文件系统或 shell 操作之前执行的一组输入验证和路径限制规则。

当前 sandbox 保护包括：

- **Workspace 边界**：所有文件和目录操作相对于 `workspaceRoot` 解析路径；任何逃出 workspace root 的路径都会被拒绝，返回 `path_outside_workspace` 错误。
- **Secret 文件阻止**：匹配 `.env`、`.env.*`、`.netrc`、`*.key`、`*.pem`、`*.p12`、`*.pfx`、`id_rsa`、`id_ed25519`、`id_ecdsa` 和 `id_dsa` 的路径会被拒绝。
- **被阻止命令模式**：匹配特定破坏性模式的 shell 命令在执行前被拒绝。
- **Shell 超时**：shell 命令默认限制为 30 秒。
- **输出截断**：shell stdout 和 stderr 截断为 4,000 字符。

## 3. Shell Tool 限制

`run_shell` tool 使用 Node.js `child_process.exec` 在 `workspaceRoot` 目录中运行 shell 命令。限制：

- 命令以与 Vole 进程相同的用户身份运行 — 无权限升级。
- 工作目录始终为 `workspaceRoot`；模型无法通过 `cd` 持久更改它。
- 通过 `exec` 的 `timeout` 选项强制超时；被终止的进程返回错误。

## 4. Workspace 边界执行

`packages/tools` 中的 `resolveWorkspacePath` 函数执行边界检查：

1. 将 `workspaceRoot` 和请求的 `path` 都解析为绝对路径。
2. 计算从 root 到绝对路径的相对路径。
3. 如果相对路径以 `..` 开头或解析到 root 外，则拒绝。

这防止了 `../` 遍历和依赖 `..` 组件的符号链接攻击。

## 5. 被阻止命令策略

无论权限级别如何，以下命令模式始终被拒绝：

- 目标为 `/` 或 `~` 的 `rm -r*` — 防止递归删除 root 或 home。
- Fork bomb 模式 `:(){ ... }` — 防止进程耗尽。
- 向块设备写入或通过管道传输（`/dev/sd*`、`/dev/hd*`、`/dev/nvme*`、`/dev/vd*`）— 防止磁盘写入。
- 磁盘管理工具：`mkfs`、`fdisk`、`parted`、`shred` — 防止磁盘格式化。

这些在 `packages/tools/src/index.ts` 的 `isBlockedCommand` 中执行。该策略保守；未来阶段可能会添加额外模式。

## 6. Phase 10 新增内容

Phase 10 不添加 OS 级别 sandboxing。Phase 10 的新增内容是组织性的：

- **Sub-agent workspace**：sub-agents 继承父 agent 的 `workspaceRoot`；它们受相同的 workspace 边界规则约束。
- **Gateway session 追踪**：`SessionGateway` 记录哪个 adapter 创建了 session，使未来阶段可以审计哪个界面触发了 tool call。
- **文档**：本文档建立了 sandbox 基线，用于未来的加固决策。

## 7. 未来加固

未来阶段可能添加：

- OS 级别 sandbox（macOS Sandbox profiles、Linux seccomp 或容器边界）。
- 每个 session 的 workspace 隔离：每个 session 获得自己的子目录。
- 每个 adapter 的 tool 允许列表：后台 adapters 可能限制为只读 tools。
- 网络访问控制：将 `read_web_page` 限制为已批准的域名。

## 8. 参考

- [Tool System](./tool-system.zh-CN.md) — tool registry 和 execution contracts
- [Permission System](./permission-system.zh-CN.md) — 风险级别和 approval policy
- [Multi-Agent Runtime](./multi-agent-runtime.zh-CN.md) — sub-agent workspace 继承
