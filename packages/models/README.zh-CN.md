# Models Package

## Architecture Summary

这个目录拥有 provider-neutral model contracts。
它在 `ModelProvider` 后面归一化 vendor behavior。
它让 Agent Core 可以调用 models，而不依赖 vendor SDK details。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 public package exports 和 build scripts。 |
| `tsconfig.json` | TypeScript config | 构建 models package。 |
| `src/index.ts` | Provider layer | 导出 model message types、ModelToolDefinition、ModelInput、ModelOutput union、StreamEvent union、StreamingModelProvider 接口、isStreamingProvider 类型守卫、FakeModelProvider、FakeStreamingProvider、支持 generate + generateStream（SSE 解析）的 OpenAI-compatible provider，以及支持 generate + generateStream（可注入 streamClient）的 Anthropic provider。 |
| `src/index.test.ts` | Provider tests | 保护 fake provider behavior、isStreamingProvider 检测、FakeStreamingProvider 流式、OpenAI SSE 流式（文本和 tool_calls）、Anthropic 流式（文本、tool_calls 和非流式回退），以及所有已有的 generate() 测试。 |

## Update Reminder

目录结构变化时更新此文件。
