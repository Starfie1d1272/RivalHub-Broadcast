# 架构决策记录

ADR 用于记录需要长期约束实现的技术或产品决策。它解释“为什么采用当前边界”，而 [`../architecture.md`](../architecture.md) 给出当前系统的干净架构视图。

## 状态

- `Proposed`：已提出，尚未冻结。
- `Accepted`：当前正式决策。
- `Superseded`：已被后续 ADR 替代。
- `Rejected`：明确评估后不采用。

## 维护规则

1. ADR 只记录长期决策，不记录某个 Issue / PR 的实施过程。
2. 精确 dependency patch 版本由 `package.json`、workspace catalog 和 lockfile 维护，ADR 只冻结技术路线和兼容边界。
3. 决策语义改变时新增 ADR 或明确 supersede；纯文字澄清可以直接修正。
4. 第三方项目只是证据，不自动成为设计规范。
5. 当前实现与 ADR 冲突时，不能通过兼容层长期掩盖冲突；应先重新确认决策。

## 当前 ADR

- [`0001-project-positioning-and-authority.md`](0001-project-positioning-and-authority.md)：产品定位与 authority。
- [`0002-runtime-workspace-technology-baseline.md`](0002-runtime-workspace-technology-baseline.md)：运行时、workspace、Web 与测试技术基线。
- [`0003-runtime-state-delivery-invariants.md`](0003-runtime-state-delivery-invariants.md)：RuntimeState、连续性、投递、身份和可靠消息不变量。
- [`0004-program-output-and-observer-assist-isolation.md`](0004-program-output-and-observer-assist-isolation.md)：正式节目与观察辅助隔离。
- [`0005-product-capability-boundaries-and-portability.md`](0005-product-capability-boundaries-and-portability.md)：Standalone / RivalHub 连接模式、产品能力线与可移植性。
