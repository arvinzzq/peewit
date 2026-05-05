# Gateway Package

English version: [README.md](./README.md)

## 架构概述

`@arvinclaw/gateway` 负责**会话 gateway 注册表**：一个进程内注册表，追踪哪些会话处于活跃状态、哪个 Adapter 托管每个会话，以及该 Adapter 具备哪些能力。它实现多 Adapter 协调，而不将 Adapter 相互耦合。

```
apps/cli ──register──▶
apps/web ──register──▶  SessionGateway  ◀── 未来：多 Agent 协调器
scheduler ───────────▶
```

Gateway 不含任何 Agent 逻辑，不存储消息，不做策略决策。它是纯注册表：记录哪些会话存在以及哪个 Adapter 拥有它们。

## 核心概念

### GatewaySession

```typescript
interface GatewaySession {
  id: string;
  adapterName: string;            // "cli", "web", "background" 等
  capabilities: AdapterCapabilities;   // 来自 @arvinclaw/adapters
  registeredAt: string;
  lastActivityAt: string;         // 由 touch() 更新
}
```

### SessionGateway

六个操作：

| 方法 | 描述 |
|---|---|
| `register(session)` | 记录新的活跃会话 |
| `unregister(sessionId)` | 会话结束时移除 |
| `touch(sessionId)` | 将 `lastActivityAt` 更新为当前时间（未知 session 时无操作） |
| `get(sessionId)` | 返回会话记录或 `undefined` |
| `list()` | 返回所有活跃会话 |
| `listByAdapter(adapterName)` | 返回特定 Adapter 的会话 |

Gateway 由 `Map<string, GatewaySession>` 支持，完全在进程内。无持久化——会话在每次 Adapter 启动时重新注册。

## 实现原理

### 为何独立一个包

没有 gateway 时，多 Adapter 系统中各 Adapter 需要相互导入代码才能回答"此工作区是否已有另一个 CLI 会话？"或"哪些会话支持审批提示？"Gateway 解耦了这个问题：Adapter 在启动时向 gateway 注册，然后查询 gateway，无需了解其他 Adapter。

### 为何不持久化

Gateway 追踪的是**实时**会话——当前已连接的会话。进程重启时所有会话结束，Adapter 重新注册。历史会话数据属于 `@arvinclaw/sessions`，而非 gateway。Gateway 的唯一真实来源是当前进程状态。

### touch() 与直接更新

`touch()` 作为独立方法存在（而非要求调用者手动更新 `lastActivityAt`），使 Adapter 可以在不重新注册整个会话记录的情况下发送活跃信号。同时，活跃时间戳由 gateway 权威设置，防止 Adapter 间的时钟偏差。

### 能力感知路由（未来）

每个 `GatewaySession` 上的 `capabilities` 字段为未来的路由决策提供支撑：
- 多 Agent 协调器可检查 `session.capabilities.approvalPrompts` 决定将审批请求路由到哪个会话。
- 后台编排器可过滤 `listByAdapter("background")` 找到所有无人值守会话。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 gateway 包，依赖 `@arvinclaw/adapters`。 |
| `tsconfig.json` | TypeScript 配置 | 使用对 adapters 的项目引用构建 gateway 包。 |
| `src/index.ts` | 会话 gateway | 所有导出：`GatewaySession`、`SessionGateway`、`gatewayPackageName`。 |
| `src/index.test.ts` | Gateway 测试 | 保护 register、unregister、touch、get、list、listByAdapter 行为及边缘情况。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。
