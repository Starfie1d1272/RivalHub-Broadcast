# Contributing to RivalHub Broadcast

RivalHub Broadcast 主要采用 Issue-driven、agent-assisted 的开发方式。任何实现都应先理解仓库里的产品与架构约束，再修改代码。

## 必读

按顺序阅读：

1. `README.md`
2. `docs/product.md`
3. `docs/architecture.md`
4. `docs/roadmap.md`
5. `docs/decisions/`
6. `AGENTS.md`
7. 当前 Issue 直接引用的专题文档

## 工作单元

一个可以直接交给 Luna / coding agent 的 Issue 必须具备：

- Objective；
- Context；
- Canonical decisions；
- Scope；
- Non-goals；
- Architecture / ownership；
- Implementation plan；
- Required tests；
- Acceptance criteria；
- Validation；
- Dependencies；
- Documentation impact；
- Handoff requirements。

如果实现过程中发现需要改变已冻结的 authority、runtime invariant、package ownership、security、recovery 或 protocol 语义，应停止扩张实现范围，并把偏差反馈到 Issue/ADR，而不是自行重设计。

## Agent-ready

`agent-ready` 只用于“不再需要主要产品/架构判断”的 Issue。

Agent 可以：

- 在 Scope 内选择局部实现细节；
- 根据测试/类型错误做最小必要修复；
- 补充与本 Issue 直接相关的测试和文档。

Agent 不可以未经明确批准：

- 更换 Runtime / framework / transport 基线；
- 引入新的 canonical state owner；
- 直连 RivalHub/Supabase 内部表；
- 让 Raw GSI 越过 telemetry adapter；
- 把 snapshot 改成可靠 FIFO；
- 新增 speculative framework/plugin system；
- 顺手重构 Issue 范围外的大块代码。

## PR 交付标准

PR 必须说明：

1. 完成了什么；
2. 没有完成什么；
3. 是否偏离 Issue 的 Canonical decisions；
4. 关键文件和 ownership 变化；
5. 实际执行过的验证命令；
6. replay / visual / Windows / OBS 等非普通单测证据（如适用）；
7. 剩余风险和后续 Issue。

PR 不应以“CI 绿了”替代业务 acceptance，也不应以 mock/simulator 代替要求中的真实环境验收。

## 设计与实现的关系

采用 just-in-time design freeze：

- 能由当前 ADR/文档直接约束的工作，可以进入实现；
- 下一 Milestone 才需要的协议、安全、Radar、Scene、Packaging 细节，不提前过度设计；
- 一旦某项成为当前 Milestone 的 blocking decision，应先固化到 docs/ADR，再标记 Issue 为 `agent-ready`。

## 完成定义

Issue 只有在以下条件都满足时才算完成：

- Scope 已实现；
- Acceptance criteria 可复现通过；
- 必要测试已加入；
- architecture guard / typecheck / lint / build 等相关检查通过；
- 文档没有与实现产生已知冲突；
- PR 中记录了实际验证证据；
- 未完成内容已经明确留给后续 Issue，而不是隐藏在 TODO 里。
