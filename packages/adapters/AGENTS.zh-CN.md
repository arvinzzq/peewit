# Adapters Agent Guide

## 职责

将 adapter capability 声明、规范常量和 `AdapterStorageType` 类型保留在这里。这个 package 是纯类型定义和常量 — 没有运行时行为，没有 I/O。

## When Files Change

当 capability 字段、常量或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

对 capability 常量的更改需要正确值和 interface 合规性的测试。Background adapters 不能有 `approvalPrompts: true` 的规则必须持续被测试。

## Boundaries

不要在这个 package 中实例化 runtime、调用 providers、执行 tools、读取 config 或渲染 UI output。这个 package 对其他 workspace packages 没有依赖。
