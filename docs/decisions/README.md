# Architecture Decision Records

ADR 用于记录会长期约束仓库的技术/产品架构决策，避免重要选择只存在于 Issue、聊天或某次实现里。

## 状态

- `Proposed`：已提出，尚未冻结；
- `Accepted`：当前正式决策；
- `Superseded`：已被后续 ADR 替代；
- `Rejected`：明确评估后不采用。

## 规则

1. 一个 ADR 聚焦一个可独立讨论的决定。
2. 记录“为什么”，不只记录最后选择。
3. 如果新事实改变旧决定，不直接重写历史；新建 ADR 并标明 supersede。
4. 第三方项目只是证据，不自动成为设计规范。
5. 重要实现如果没有对应的产品需求或 ADR，不应由 Agent 自行扩张范围。

## 当前 ADR

- [`0001-project-positioning-and-authority.md`](0001-project-positioning-and-authority.md)：项目定位与权威边界。
- [`0002-runtime-workspace-technology-baseline.md`](0002-runtime-workspace-technology-baseline.md)：Runtime、TypeScript/ESM、pnpm workspace、Web/server 构建与测试技术基线。
