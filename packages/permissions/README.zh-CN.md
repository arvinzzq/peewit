# Permissions Package

English version: [README.md](./README.md)

## 架构概述

`@peewit/permissions` 负责**权限策略边界**：给定工具动作和当前自主模式，产生决策（`allow`、`ask` 或 `deny`）及可读原因。它不执行工具、不渲染 UI、不调用 API，唯一输出是 `PermissionDecision`。

```
AgentRuntime
    │  对每次工具调用：
    ▼
PermissionPolicy.evaluate({ mode, action })
    │
    ▼
PermissionDecision { decision, risk, reason }
    ├─ "allow" → 立即执行
    ├─ "ask"   → 发出 approval_requested，调用 ApprovalResolver
    └─ "deny"  → 运行失败
```

## 核心概念

### 权限决策的两个维度

**`AutonomyMode`** — 用户选择的 Agent 自主级别：
- `"observe"`：所有外部动作前需询问。
- `"confirm"`（默认）：低风险自动执行，中/高风险需审批。
- `"auto"`：低和中风险自动执行，仅高风险需审批。

**`PermissionRiskLevel`** — 工具声明的内在风险级别：
- `"low"`：只读、可逆、无副作用（如 `read_file`、`list_directory`）。
- `"medium"`：写入或有限影响的调用（如 `write_file`、`spawn_subagent`）。
- `"high"`：广泛或不可逆影响（如 `run_shell`）。
- `"blocked"`：永久拒绝，与模式无关。

### 决策矩阵

`DefaultPermissionPolicy.evaluate()` 实现此矩阵：

| 模式 \ 风险 | `"blocked"` | `"low"` | `"medium"` | `"high"` |
|---|---|---|---|---|
| `"observe"` | deny | ask | ask | ask |
| `"confirm"` | deny | allow | ask | ask |
| `"auto"` | deny | allow | allow | ask |

关键不变量：`"blocked"` 始终 deny；`"observe"` 对非阻断工具始终 ask；`"auto"` 仅对 `"high"` 风险升级为 ask。

### PermissionDecision

```typescript
interface PermissionDecision {
  decision: "allow" | "ask" | "deny";
  risk: PermissionRiskLevel;
  reason: string;  // 可读，安全地包含在 trace 中
}
```

`PermissionPolicy` 是同步的且无副作用，可安全地在 Agent 循环热路径中调用。

## 实现原理

### 为何独立一个包

权限决策是策略关注点，而非工具或运行时关注点：
1. **工具不了解策略**：`risk` 是元数据，工具不检查自身权限。
2. **运行时不了解策略逻辑**：运行时只调用 `evaluate()` 并响应结果。
3. **策略独立可测试且可替换**：可注入自定义 `PermissionPolicy`。

### 自主模式归一化

`AgentRuntime` 调用 `normalizeAutonomyMode()` 将未知字符串映射为 `"confirm"`，防止配置错误绕过权限检查。

### "blocked" 风险级别

`risk: "blocked"` 的工具永久不可用。可存在于注册表中用于自省，但策略无条件返回 `"deny"`，不咨询审批解析器。

## 文件清单

| 文件 | 角色 | 用途 |
|---|---|---|
| `package.json` | Package manifest | 声明 permissions 包（不依赖其他工作区包）。 |
| `tsconfig.json` | TypeScript 配置 | 构建 permissions 包。 |
| `src/index.ts` | 权限策略 | 所有导出：`AutonomyMode`、`PermissionRiskLevel`、`PermissionDecisionType`、`PermissionAction`、`PermissionEvaluationInput`、`PermissionDecision`、`PermissionPolicy`、`DefaultPermissionPolicy`。 |
| `src/index.test.ts` | 权限测试 | 覆盖决策矩阵所有单元格：observe/confirm/auto × low/medium/high/blocked。 |

## 更新提醒

当目录结构或模块职责变化时更新此文件。
