# Phase 16：沙箱与插件运行时

状态：计划中
日期：2026-05-11

English version: [phase-16-sandbox-and-plugin-runtime.md](./phase-16-sandbox-and-plugin-runtime.md)

## 1. 目的

Phase 16 把沙箱从"`VOLE_SANDBOX=true` 这个仅锁定 shell cwd 的布尔值"升级为真正的后端系统，并把插件 / skill 生态从"被加载的、影响 prompt 的 markdown"升级为可以安全执行第三方代码的运行时。同时引入 `vole doctor`，对应 OpenClaw 文档中 tombstone 与反复 wedge 的那类陈旧状态做自维护。

Phase 16 依赖 Phase 11（gateway 与 lane）所提供的生命周期钩子来强制沙箱决策，并依赖 Phase 15（多 agent 身份）来支持 per-agent 沙箱策略。

## 2. 范围

本 phase 包含：

- `packages/permissions` 中的 `SandboxBackend` 接口（执行边界决策的最合适归宿）。
- 后端：`WorkspaceSandbox`（当前行为重构为后端）、`DockerSandbox`（每次执行起容器）、`WorkerThreadSandbox`（JS 工具与不可信 skill 用）。
- `sandbox.backend` 配置字段，并支持 per-tool 覆盖。
- worker-thread 隔离的插件 / skill 运行时：不可信 skill 在 worker thread 中执行，受 `timeout` 与 `maxMemoryMB` 限制；throw 的 skill 不会弄崩主进程。
- `vole skills trust <name>` 已在 Phase 9 存在；Phase 16 让 trust 真正有意义（trusted = inline，untrusted = worker thread）。
- `vole doctor` 与 `vole doctor --fix` 用于自维护：陈旧子代理记录、孤儿 TaskFlow 行、残留锁文件、不匹配的 session key 树。
- 重写架构文档 `sandboxing.md`，描述后端系统。

本 phase 不包含：

- Linux 上的 firejail / bubblewrap 集成（推迟；macOS 无原生方案）。
- 直接的 cgroup 级 CPU / 内存上限（Docker 需要时覆盖）。
- 强制所有工具沙箱化（按配置或风险等级 opt-in）。
- 超出"拉取默认基础镜像"的容器镜像管理。

## 3. 架构摘要

### SandboxBackend 接口

```ts
interface SandboxBackend {
  name: "workspace" | "docker" | "worker";
  execute(command: SandboxCommand, options: SandboxOptions): Promise<SandboxResult>;
  available(): Promise<boolean>;
}

interface SandboxOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxMemoryMB?: number;
  network?: "allow" | "deny";
}
```

执行代码的工具（`run_shell`、未来的 code-eval 工具、不可信 skill）调用 `sandbox.execute(...)`，而非直接 spawn 进程。后端选择取决于配置加工具风险等级。

### Docker 后端

`DockerSandbox` 在临时容器中运行每条命令：

- 默认镜像可配置（`sandbox.docker.image`，默认 `node:lts-alpine` 或类似的小镜像）。
- 默认只读挂载 workspace；需要写入的工具显式列出路径。
- 默认网络 `deny`；逐命令放行。
- 容器生命周期为单次执行；日志与退出码捕获。
- 未安装 Docker 时后端 `available(): false`，系统优雅降级。

### Worker Thread 插件运行时

标记为 `trusted: true` 的 skill inline 执行；不可信 skill 在 `worker_threads.Worker` 中运行：

- Worker 启动时使用受限模块表（无 `node:fs`、无任意网络）。
- Worker 内的工具调用通过 RPC 回到主进程，再走正常 permission policy。
- 触发 timeout 或内存上限时 worker terminate。
- Worker 中的异常不会传播到主事件循环。

让安装陌生人的 skill 安全到可以是日常动作，而非安全决策。

### Doctor 工具

`vole doctor` 执行只读健康检查。`vole doctor --fix` 应用修复。检查包括：

- 运行时长超过 `staleRunWindowMinutes` 的陈旧子代理 TaskFlow 行。
- 父记录已消失的孤儿 TaskFlow child。
- 拥有进程 PID 已死的残留 `.lock` 文件。
- 相对 SQLite 镜像看起来被截断的 session JSONL 文件。
- 指向缺失文件的 skill 元数据。

每项检查输出可读诊断，并提供 `--fix` 动作。结尾的摘要行参考 `openclaw doctor` 的 UX。

## 4. 提交序列

1. **docs**：本计划 + zh-CN、`sandboxing.md` 重写 + zh-CN、`plugin-system.md` 更新 + zh-CN、roadmap 更新 — docs:check 必须通过。
2. **feat(permissions)**：`SandboxBackend` 接口，`WorkspaceSandbox` 重构为后端，测试。
3. **feat(permissions)**：`DockerSandbox` 后端；依赖 Docker 可用的集成测试。
4. **feat(permissions,skills)**：`WorkerThreadSandbox` 后端；不可信 skill 路由至该后端；覆盖 throw / timeout / 内存上限的测试。
5. **feat(cli)**：`vole doctor` 只读检查。
6. **feat(cli)**：`vole doctor --fix` 动作。
7. **docs**：标记 Phase 16 完成。

## 5. 验收标准

- 每次提交都通过 `pnpm run check` 与 `pnpm run check:bundle`。
- 测试安装一个 throw 的合成不可信 skill；主进程不崩溃，skill 报为失败。
- 测试安装一个分配大 buffer 的合成不可信 skill；worker terminate 并报 `memory_exceeded` 错误。
- 配置 `sandbox.backend: "docker"` 时，`run_shell` 在只读挂载 workspace 的容器内执行（依赖 Docker 的测试，无 Docker 时跳过）。
- `vole doctor` 检测到注入的陈旧子代理行并报告；`vole doctor --fix` 解决之。
- Worker-thread skill 进行的工具调用走正常 permission policy（测试断言 policy 被咨询）。

## 6. 非目标

- 不做 firejail / bubblewrap 集成。
- 不直接使用 cgroup。
- 不强制每个工具都沙箱化。
- 不做超出单次临时运行的容器编排。
- 不做远程沙箱派发。

## 7. 相关文档

- [Phase 11 Gateway 与 Lane 基础设施](./phase-11-gateway-and-lanes.zh-CN.md)
- [Phase 15 Channels 与多 Agent 身份](./phase-15-channels-and-multi-agent-identity.zh-CN.md)
- [Sandboxing](../architecture/sandboxing.zh-CN.md)
- [Plugin System](../architecture/plugin-system.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
