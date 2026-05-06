# Documentation System

状态：草案
日期：2026-05-02

English version: [documentation-system.md](./documentation-system.md)

## 1. 目的

本文档定义 Peewit 文档如何组织、更新、拆分、翻译和 review。

文档是产品的一部分。它应该帮助用户操作 Peewit，也帮助学习者理解通用 Agent 背后的架构。

核心规则：

文档应该让项目更容易导航，而不是变成第二套隐藏实现。

## 2. 目录职责

文档目录有明确职责。

| 目录 | 职责 |
| --- | --- |
| `docs/product/` | 产品意图、已接受设计、范围和产品层权衡 |
| `docs/roadmap/` | Phase goals、acceptance criteria 和 non-goals |
| `docs/architecture/` | 模块职责、边界、风险、测试和协作 |
| `docs/plans/` | 开始写代码前的 phase implementation plans |
| `docs/research/` | 参考系统、source investigation 和 external research notes |
| `docs/decisions/` | 稳定架构决策和权衡 |

如果一个文档无法清楚归入某个目录，内容可能需要拆分。

## 3. Product Documents

Product documents 回答：

- 我们在构建什么？
- 它面向谁？
- 每个阶段应该产生什么产品结果？
- 什么在范围内，什么不在范围内？
- 哪些 trade-offs 已被接受？

Product documents 应保持简洁。详细架构应链接到 `docs/architecture/`。

## 4. Roadmap Documents

Roadmap documents 回答：

- 当前处于哪个 phase？
- 该 phase 产出什么用户可见结果？
- 新增哪些 architecture modules？
- 验收标准是什么？
- 非目标是什么？

Roadmap documents 可以把 planned future docs 以文件名列出，但应说明它们尚未创建。

## 5. Architecture Documents

Architecture documents 回答：

- 为什么这个模块存在？
- 它拥有什么？
- 它不拥有什么？
- 它的输入和输出是什么？
- 它如何与其他模块协作？
- 风险是什么？
- 哪些测试保护它？
- 哪些内容被延后？

Architecture documents 应足够具体，可以指导实现，但不应假装是最终代码。

## 6. Plan Documents

Plan documents 回答：

- 这个 phase 会实现什么？
- 什么明确不在范围内？
- 工作应该按什么顺序发生？
- 需要哪些测试？
- 哪些验证命令应该通过？
- 推荐的 commit boundaries 是什么？

相关 plan review 前，不应该开始实现。

## 7. Research Documents

Research documents 记录：

- 使用的 sources
- 已确认事实
- 推论
- 开放问题
- 参考系统模式
- 对 Peewit 的影响

Research 应区分官方来源和推论。

## 8. Decision Records

Decision records 用于稳定架构选择。

以下情况使用 decision record：

- 存在多个可行方案。
- 选择影响多个模块。
- 未来可能重新质疑这个选择。
- 权衡应该容易找到。

Decision records 应包含 context、decision、rationale、consequences 和 related docs。

## 9. 双语策略

重要文档必须有英文和简体中文两个版本。

规则：

- 英文文件使用 `.md`。
- 简体中文文件使用 `.zh-CN.md`。
- 两个版本必须是完整翻译。
- Headings 必须保持结构对齐。
- Tables、examples、diagrams、test requirements 和 acceptance criteria 必须保持对齐。
- 更新应在同一次 change 中修改两个语言版本。

当英文技术词是项目概念时，可以保留不翻译，但周围解释应该完整。

## 10. 拆分策略

以下情况应拆分文档：

- 它混合了 product decisions 和 module implementation details。
- 某个 section 本身已经有独立价值。
- 文档变得难以 review。
- 不同受众需要不同层级细节。
- 同一概念被多个地方引用。

拆分后，原文档应作为 overview 保留，并链接到聚焦文档。

## 11. Planned Documents

Planned documents 可以先出现在 roadmap 中，即使文件尚未存在。

规则：

- 有用时将未来 docs 标记为 planned。
- 不要把缺失文件作为普通 Markdown 链接。
- 当对应 phase 变为 active，或早期实现需要该边界时，再创建文档。
- `docs/README.md` 应聚焦现有重要文档，而不是每个 planned future file。

## 12. 链接策略

对已有 docs 使用相对 Markdown links。

移动文件时：

- 更新所有引用。
- 运行 Markdown link check。
- 运行 bilingual heading checks。
- 用一个聚焦 commit 完成移动。

## 13. 文档检查

有用检查：

- 没有 broken Markdown links。
- 双语 heading count alignment。
- 没有旧目录 stale references。
- Planned docs 被清楚标记。
- Main index 指向当前关键 docs。

这些检查可以先用手动命令，后续再自动化。

## 14. 验收标准

Documentation system 成功标准：

- 读者可以快速找到 product、roadmap、architecture、plan、research 和 decision docs。
- 重要 docs 是双语且结构对齐的。
- Planned docs 不会和 existing docs 混淆。
- 大主题被拆成聚焦文档。
- 文档支持实现，而不是重复实现。

## 15. 相关文档

- [Documentation Index](../README.zh-CN.md)
- [Development Workflow](./dev-workflow.zh-CN.md)
- [Testing Strategy](./testing-strategy.zh-CN.md)
- [Main Design](../product/peewit-design.zh-CN.md)
- [Roadmap](../roadmap/overview.zh-CN.md)
