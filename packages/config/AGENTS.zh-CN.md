# Config Agent Guide

## Responsibility

把 configuration precedence、workspace/model environment overrides、provider-specific shortcuts、validation 和 redaction 保持在这里。其他 packages 应接收 effective configuration 或配置好的依赖，而不是自己读取 config。

## When Files Change

当 config fields、precedence 或 file inventory 变化时，更新 README 和 AGENTS 文件。当 inputs、outputs 或 system position 变化时，更新 `src/index.ts` 文件头。

## Testing

Config changes 需要 defaults、override precedence、workspace/model environment overrides、provider-specific shortcuts、invalid values 和 secret redaction 的测试。

## Boundaries

不要在这个 package 中实例化 runtime、调用 providers、执行 tools 或渲染 CLI output。
