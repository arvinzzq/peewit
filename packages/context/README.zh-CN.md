# Context Package

## Architecture Summary

这个目录拥有 provider-neutral context assembly。
它按确定顺序从具名 sections 组装 model input：identity、runtime、tooling、safety、skills、workspace、conversation_history 和 user_message。
它从调用方接受 tool summaries、skill index 和 permission guidance，无需导入这些 packages。
它生成 per-section assembly report，调用方可以检查哪些内容被 included 或 omitted 及其原因。

## File Inventory

| File | Role | Purpose |
| --- | --- | --- |
| `package.json` | Package manifest | 声明 context package exports 和对 models 的依赖。 |
| `tsconfig.json` | TypeScript config | 使用对 models 的 reference 构建 context。 |
| `src/index.ts` | Context assembler | 导出 context assembly contracts、基于具名 sections 的 assembler、tool summary 和 skill index 输入、permission guidance、可选的 workspace prompt file loading、用于防止 context overflow 的 `compactMessages`、`CompactionOptions` 和 `DEFAULT_COMPACTION_OPTIONS`。 |
| `src/index.test.ts` | Context tests | 保护 section ordering、section inclusion 和 omission、tooling section format、safety section format、skills section format、workspace prompt loading、short-term conversation history、assembly reports 和 `compactMessages` compaction 行为。 |

## Update Reminder

目录结构变化时更新此文件。
