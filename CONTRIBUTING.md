# Contributing to RivalHub Broadcast

RivalHub Broadcast 主要采用 Issue-driven、agent-assisted 的开发方式。任何实现都应先理解仓库里的产品与架构约束，再修改代码。

## 必读

按顺序阅读：

1. `README.md`
2. `docs/product.md`
3. `docs/architecture.md`
4. `docs/roadmap.md`
5. `docs/development-validation.md`
6. `docs/decisions/`
7. `AGENTS.md`
8. 当前 Issue 直接引用的专题文档

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
- Implementation environment；
- Automated validation；
- Real-environment acceptance gate；
- Dependencies；
- Documentation impact；
- Handoff requirements。

如果实现过程中发现需要改变已冻结的 authority、runtime invariant、package ownership、security、recovery 或 protocol 语义，应停止扩张实现范围，并把偏差反馈到 Issue/ADR，而不是自行重设计。

## 开发环境与验收环境

本项目不把“在哪里写代码”和“在哪里最终验收”混成一个概念。

默认模型：

```text
Development
  cross-platform / contributor environment
        ↓
Automated validation
  deterministic tests + GitHub Actions
        ↓
Real-environment acceptance（按需）
  Windows / Windows+CS2 / Windows+OBS / Windows+CS2+OBS
```

具体规则见 `docs/development-validation.md`。

GitHub-hosted runner 是自动化验证环境，不替代真实 Windows + CS2/OBS 验收。如果 Issue 可以继续实现和自动验证，只是等待真实 Windows/CS2/OBS 证据，不应把整个任务标成 `blocked`；使用 `needs-windows-validation` 或 Project 的 Platform validation 字段表达 pending gate。

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

如果某项真实环境验收当前不可执行，Agent 应：

1. 完成所有可在当前环境完成的实现和自动验证；
2. 不伪造真实 Windows/CS2/OBS 结果；
3. 在 PR 中明确列出 pending acceptance；
4. 如果该 acceptance 是 Issue closing gate，则不得声称 Issue 已完全完成。

## PR 交付标准

PR 必须说明：

1. 完成了什么；
2. 没有完成什么；
3. 是否偏离 Issue 的 Canonical decisions；
4. 关键文件和 ownership 变化；
5. 实际执行过的验证命令；
6. macOS / Windows CI / real Windows / CS2 / OBS 等平台验证状态；
7. replay / visual / soak 等非普通单测证据（如适用）；
8. 剩余风险和后续 Issue；
9. **Documentation impact：实现是否改变了 README、产品/架构、协议、telemetry、运行或验证文档描述的事实；如改变，必须在同一 PR 更新。**

PR 不应以“CI 绿了”替代业务 acceptance，也不应以 mock/simulator 代替要求中的真实环境验收。

文档不是每个 PR 的流水账。以下内容通常留在 Issue/PR/Project，而不进入长期文档：

- 单次调试过程与中间失败；
- 当前开发机/协作者是否可用；
- 一次性 commit SHA、PR 状态或短期执行顺序；
- 已经被实现取代的 implementation plan；
- 不构成长期开发表面的内部实现细节。

以下变化则必须同步文档：

- authority / ownership / package boundary；
- public or cross-package contract；
- runtime invariant / continuity / delivery semantics；
- security / recovery / publication guarantee；
- evidence-backed source semantics；
- 用户或 operator 可见的运行方式；
- milestone scope / acceptance model。

如果代码与长期文档发生冲突，不能以“以后再补文档”作为 PR 完成状态。

## Architecture contract

提交前必须运行 `pnpm architecture:check`。它检查 shared package 的 `dist` exports、workspace protocol、显式 workspace dependency、runtime cycle、TypeScript `paths` 以及各 package 的 ownership boundary。

架构 violation 应通过复用现有 owner、调整真实依赖边界或更新对应 ADR 解决；不得新增 baseline、known-violation 或全局 ignore。ESLint 的 direct-import 提示来自同一份 `scripts/architecture/policy.mjs`，但完整 graph 检查以 `architecture:check` 为准。

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
- Issue 声明的 automated validation 已完成；
- Issue 声明为 closing gate 的 real-environment acceptance 已完成；
- **受实现影响的长期文档已在同一 PR 同步，且没有与实现产生已知冲突；**
- PR 中记录了实际验证证据；
- 未完成内容已经明确留给后续 Issue，而不是隐藏在 TODO 里。
