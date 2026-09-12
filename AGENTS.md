# RivalHub Broadcast Agent 工作约定

本仓库大量开发可能由 coding agent 完成。Agent 必须先理解产品与架构边界，再写代码。

## 必读顺序

1. `README.md`
2. `docs/product.md`
3. `docs/architecture.md`
4. `docs/roadmap.md`
5. `docs/development-validation.md`
6. `docs/decisions/`
7. `CONTRIBUTING.md`
8. 当前 Issue 与其直接引用的协议/运行文档

如果当前 Issue 标记为 implementation-ready / `agent-ready`，其 `Canonical decisions`、Scope、Non-goals、Acceptance criteria、platform/validation gate 是本次实现的直接执行规格；不得在实现过程中擅自重新设计这些已冻结内容。

## 文档语言

仓库一手文档默认中文。代码 symbol、schema 字段、行业术语和第三方项目名可保留英文。

## 不可破坏的边界

- RivalHub 是 official tournament truth owner；Broadcast 不建立第二套赛事数据库。
- 不直接连接/写入 RivalHub Supabase 表；只走公开 adapter/contract。
- Raw GSI 只存在 telemetry adapter 内，不泄漏到 Core/Renderer/public protocol。
- `packages/core` 不依赖 React、HTTP/WebSocket 实现、OBS、RivalHub DB 或具体 GSI parser。
- Core 只有一份内部 `RuntimeState`；Program/Radar/Operator/Debug/BroadcastLiveSnapshot 通过 projection 获取 consumer-specific model，不把整个 RuntimeState 当通用 wire payload。
- `ReliableObservation` 不是 current-state projection；它应由 RuntimeTransition + transition-time RuntimeState/context 派生并保留必要 evidence。
- CompetitionEntry / Steam64 是稳定赛事身份；CT/T 与 observer slot 只是运行时映射。
- Identity 不得简化为一个 boolean；至少区分 unbound / resolving / matched / degraded / mismatch，并据此 gate capability。
- 高频 snapshot 必须 latest-wins / bounded；禁止无界排队旧状态。每个 consumer 只允许“正在发送 + 最新 pending”这类常数级 backlog。
- `RuntimeTransition`、`OperatorCommand`、`ReliableObservation`、`Incident` 语义分离；不要建设万能 EventJournal/event-sourcing。
- ReliableObservation 可以进入 bounded durable outbox；canonical/high-impact command 不得离线排队后静默执行。
- Simulator/replay 必须通过生产 ingress/normalizer，不直接伪造最终 RuntimeState/projection。
- 本地 duration/timeout/staleness 使用 monotonic clock；跨机器 observedAt/producedAt/audit 使用 UTC wall clock。
- 高级视觉效果只能在真实 telemetry capability 存在时启用，不能伪造数据精度。
- Radar domain 与 Web renderer 分离；`packages/radar` 不得依赖 React/DOM。
- 不复制参考项目代码，除非已经明确确认许可证与复用方式；更新 `THIRD-PARTY-NOTICES.md`。

## 跨仓 Contract 规则

Broadcast-owned local contract：

```text
Companion ↔ Program
Companion ↔ Operator
Companion ↔ Debug
```

RivalHub-owned API boundary：

```text
BroadcastManifest
#610 Reliable Observation ingest
#615 Live Snapshot ingest
```

Broadcast 的 `packages/rivalhub` 只作为这些公开 contract 的 client/producer adapter；可以使用 machine-readable schema、validator 与 compatibility fixture，但不得 import RivalHub 源码类型。

术语：

```text
BroadcastLiveSnapshot       Broadcast → #615 producer payload
EphemeralLiveProjection     RivalHub #615 server-side projection
PublicLiveMatchProjection   公共页面 read model
```

## 平台与验收规则

Agent 必须区分：

```text
Implementation environment
Automated validation
Real-environment acceptance gate
```

不得把“当前没有 Windows/CS2/OBS 环境”解释成平台无关代码无法继续开发，也不得用 mock/CI 伪装成真实生产验收。

如果当前环境无法执行 Issue 要求的真实 Windows/CS2/OBS acceptance：

1. 完成所有可执行的实现、单测、replay 和 CI 工作；
2. 在 PR 的 Platform validation 中明确标记 `Pending`；
3. 不虚构或推测真实环境结果；
4. 如果真实环境证据属于 closing gate，则不得声称 Issue 已完全完成；
5. 不因为只欠 platform validation 就把其它仍可继续的开发工作错误标记为 blocked。

默认协作模型是 `Feature owner + Platform validator`，不是按操作系统切割完整业务模块。详见 `docs/development-validation.md`。

PR 的自动化代码验证由 `ci-gate` 汇总，PR 标题由独立的 `pr-title` check 验证。GitHub-hosted Windows runner 只属于 automated validation，不等于真实 Windows + CS2/OBS acceptance。

## 变更原则

- 先复用已有 owner，不建立重复基础设施。
- 涉及协议、authority、package ownership、recovery、security、packaging 的重要变化先写/更新 ADR。
- 产品需求变化先更新 `docs/product.md`。
- 不因为某个参考仓库这么实现，就默认采用其架构。
- 不为尚未存在的 consumer 提前建设复杂 plugin framework。
- 不为了“先看到画面”把 GSI shape 直接传到 React 组件。
- 不为单一 Major renderer 提前设计通用 renderer SDK；出现第二个真实 consumer 再抽象。
- Issue 范围外发现的问题，优先记录/开后续 Issue；除非当前任务无法正确完成，不顺手扩张实现范围。

## 可执行架构护栏

- `pnpm architecture:check` 是当前 workspace 的权威架构依赖检查；新 workspace dependency 必须显式声明并使用 `workspace:` protocol。
- 不得跨 package deep-import 其他 package 的 `src/`，也不得通过 TypeScript `paths` 绕过 package `exports`。
- Core、Protocol、Radar、Web 与 RivalHub 的 forbidden dependency 规则以 `scripts/architecture/policy.mjs` 为机器规则来源；不要通过 baseline、known-violation 或 wildcard ignore 让检查变绿。
- 如果真实产品需求与架构护栏冲突，先重新审视对应 docs/ADR 并单独更新决策，不在实现中绕过 guard。

## 测试原则

任何实时链路改动至少考虑：

- normal replay；
- slow consumer / backpressure；
- reconnect；
- duplicate/out-of-order；
- wrong match；
- stale manifest；
- map/round boundary；
- map restart / stale epoch；
- outbox retry / stale invalidation；
- 内存/queue 是否随时间增长。

Browser reconnect 默认读取 current baseline projection 后继续，不重放全部离线 snapshot。

实际生产验收最终需要真实 Windows + CS2 spectator + OBS 彩排，mock/simulator 不能替代真实运行证据。
