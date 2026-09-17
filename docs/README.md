# 文档索引

本目录记录 RivalHub Broadcast 的长期产品、架构、协议、数据语义和验证规则。长期文档只描述**当前有效的事实与约束**；单次实现过程、短期排期、某个 PR 的完成情况和一次性调试记录留在 Issue / PR / Project。

仓库一手文档默认使用中文。术语边界见 [`terminology.md`](terminology.md)。

## 一手文档

| 文档 | 负责回答 |
| --- | --- |
| [`product.md`](product.md) | 产品是什么、服务谁、哪些能力属于产品边界 |
| [`architecture.md`](architecture.md) | 当前系统如何分层、谁拥有什么、哪些依赖方向不可破坏 |
| [`protocol.md`](protocol.md) | RivalHub 只读赛事上下文与本地 WebSocket 协议 |
| [`telemetry.md`](telemetry.md) | GSI / CSTV 输入如何解释、标准化和验证 |
| [`development-validation.md`](development-validation.md) | 开发、CI、视觉回归和真实环境验收如何分责 |
| [`roadmap.md`](roadmap.md) | 能力之间的依赖顺序和阶段边界 |
| [`references.md`](references.md) | 参考项目能借鉴什么、哪些实现和许可证不能直接继承 |
| [`terminology.md`](terminology.md) | 中文术语与用户可见文案规范 |

## 决策与研究

- [`decisions/`](decisions/)：已经接受、需要长期约束实现的架构决策。
- [`rfcs/`](rfcs/)：仍存在重要开放问题的专项设计研究。

ADR 负责记录“为什么采用当前边界”，`architecture.md` 负责给出**当前架构的干净视图**。当二者表达不一致时，应先判断决策是否已经改变：如果改变，更新或新增 ADR；如果只是长期文档漂移，直接修正文档。

## 文档权威关系

```text
product.md
  产品目标、用户、能力边界
        ↓
architecture.md + Accepted ADR
  ownership、依赖方向、运行时不变量
        ↓
protocol.md / telemetry.md
  具体契约与数据源语义
        ↓
development-validation.md
  验证与验收规则

roadmap.md
  只描述能力依赖和演进顺序，不承担当前实施状态

Issue / PR / Project
  当前工作规格、短期状态、一次性调查与交付证据
```

`references.md` 和 RFC 提供设计证据，但不能覆盖 Accepted ADR 或当前一手文档。

## 维护规则

长期文档应满足：

- 使用现在时描述当前有效行为；
- 不写“即将”“随后由某 Issue 完成”“某 PR 已经实现”等执行状态；
- 不把 Issue 编号当成架构或协议名称；
- 不复制已经由代码常量、`package.json` 或 lockfile 精确维护的易变版本信息；
- 协议示例必须与当前 schema 一致；
- 用户或制作人员可见的运行方式发生变化时同步更新；
- 已被实现取代的设计过程从长期文档移除，不保留兼容性叙述。

如果代码改变了本文档描述的长期事实，修改代码的同一 PR 必须同步更新相应文档。
