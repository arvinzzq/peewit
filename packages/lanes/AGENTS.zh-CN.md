# Lanes Agent Guide

## 职责

在此保持 run 准入与串行化。`Lane` 是带并发上限的 FIFO 队列；`LaneRegistry` 把三层（global、subagent、per-session）组合成 gateway 接受的每个 run 必须穿过的链路。

## 文件变更时

当准入职责或文件清单变化时更新 README 与 AGENTS。当输入、输出或系统位置变化时更新 `src/index.ts` 头注释。

## 测试

Lane 逻辑需要测试：高负载下的 FIFO 顺序、并发上限执行、成功与拒绝路径上的槽位释放、session-lane 生命周期（懒创建 + 仅空闲回收），以及通过 `runThroughLanes` 的 lane chain 组合。

## 边界

不要在此 import `AgentRuntime`、sessions、models 或任何其他 workspace package。Lanes 是 run 准入栈的最底层；必须保持无依赖，以便独立单元测试并被 `@vole/gateway` 消费时不产生循环。

不要做任何 I/O。无文件锁、无网络、无日志。跨进程串行化属于 session 存储层的文件锁；lanes 只在一个 Node 进程内排序工作。
