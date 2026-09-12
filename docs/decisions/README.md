# Architecture Decision Records

ADR 用于记录会长期约束仓库的技术/产品架构决策，避免重要选择只存在于 Issue、聊天或某次实现里。

## 状态

- `Proposed`：已提出，尚未冻结；
- `Accepted`：当前正式决策；
- `Superseded`：已被后续 ADR 替代；
- `Rejected`：明确评估后不采用。

## 规则

1. 一个 ADR 聚焦一组具有共同决策原因、可以独立演进/被 supersede 的决定；不要求“一项依赖一个 ADR”。
2. 记录“为什么”，不只记录最后选择。
3. 如果新事实改变旧决定，不静默改写历史语义；新建 ADR，并明确 supersede 的具体旧决定/范围。
4. 对已接受 ADR 的非语义性勘误或“让正文与已接受决策保持一致”的澄清，应显式标注 clarification；如果实际决策发生改变，仍必须新建 ADR supersede。
5. 第三方项目只是证据，不自动成为设计规范。
6. 重要实现如果没有对应的产品需求或 ADR，不应由 Agent 自行扩张范围。
7. 精确 dependency version 由 `package.json` / lockfile 记录；同一既定技术路线内的兼容 patch/minor 升级通常不需要新 ADR，除非改变架构语义或生产兼容边界。

## 当前 ADR

- [`0001-project-positioning-and-authority.md`](0001-project-positioning-and-authority.md)：项目定位与权威边界。
- [`0002-runtime-workspace-technology-baseline.md`](0002-runtime-workspace-technology-baseline.md)：Runtime、TypeScript/ESM、pnpm workspace、Web/server 构建与测试技术基线。
- [`0003-runtime-state-delivery-invariants.md`](0003-runtime-state-delivery-invariants.md)：RuntimeState/projection、transition-derived ReliableObservation、session/identity、delivery/backpressure、observation outbox、Radar/scene 与跨仓 contract invariant；其中 EventJournal/泛化 Event 语义 supersede ADR-0002 决策 5 的对应旧表述，跨仓 contract ownership supersede ADR-0002 决策 6 的过宽表述。