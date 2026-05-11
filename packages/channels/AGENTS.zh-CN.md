# Channels Agent Guide

## 职责

拥有入站界面层：定义 `Channel` 接口、为进程持有运行中的 channel 的 `ChannelRegistry`、提供用于测试的 `FakeChannel`。后端（Telegram、email）与 gateway 路由接线在 Phase 15b。出站 `send` 是 Channel 契约的一部分；注册表从不伸手到具体 channel 调用传输代码。

## 文件变更时

当接口、注册表语义或文件清单变化时更新 README 与 AGENTS。当 inputs、outputs 或 system position 变化时更新 `src/index.ts` 头。EN 与 zh-CN 之间的 heading 对等必须保持以通过 docs:check。

## 测试

测试必须覆盖：FakeChannel 生命周期（send-before-start 拒绝、通过 handler 的入站注入、send + stop）、ChannelRegistry（重复 id 拒绝、startAll / stopAll、按 agentId 和 kind 过滤 list、remove、跨 channel 的 handler 共享）、sessionKeyForInbound（threadKey 存在 + 不存在）。15b 的真实后端加入后，需通过共享一致性测试套件以匹配同一组断言。

## 边界

不要在 `src/index.ts` 中 import `@vole/gateway`、`@vole/core` 或任何运行时层。`InboundHandler` 回调是接缝：adapter 把 `channel.start(handler)` 接到一个调用 `gateway.submit` 的函数，让 channels 不依赖 gateway package。

不要在此做任何工具风格的工作。权限决策、agent 端读 MEMORY.md、工具执行分别留在 `@vole/permissions`、`@vole/memory`、`@vole/tools`。Channels 携带消息；不解释消息。

后端依赖（telegram-bot-api、IMAP/SMTP 客户端）属于子包或未来的顶层 package，如 `@vole/channels-telegram` / `@vole/channels-email` —— 保持 `@vole/channels` 本身无依赖，让它平凡可测。
