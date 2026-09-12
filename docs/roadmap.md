# Delivery Roadmap

> 本文只定义阶段级交付目标、依赖顺序和执行治理。产品需求以 `docs/product.md` 为准；长期架构 invariant 以 `docs/architecture.md` 与 ADR 为准；开发/自动验证/真实生产环境的职责边界见 `docs/development-validation.md`；具体实现要求以对应 Issue 为准。

## 管理模型

RivalHub Broadcast 使用四层信息结构：

```text
Docs / ADR
  长期产品与架构真相
        ↓
Milestone
  一个阶段真正要获得的能力
        ↓
Issue
  可交给 Agent/Luna 独立执行的工作单元
        ↓
PR
  实现、验证证据与偏差说明
```

GitHub Project 仅作为跨 Issue/PR 的视图，不成为新的规格来源。

Milestone 标题使用中文以提高项目管理可读性；代码 symbol、package、protocol/schema 字段继续使用适合工程语境的英文。

## Milestones

### M0 — 工程基础

目标：把设计仓转为可稳定开发、可验证且不会轻易破坏架构边界的工程仓。

完成条件至少包括：

- pnpm workspace / package manifests / lockfile；
- TypeScript / ESM 基线；
- ESLint / Prettier；
- Vitest；
- Vite Web shell；
- Fastify Companion shell；
- architecture/dependency guard；
- 基础 GitHub Actions CI；
- `/program`、`/operator`、`/debug` shell；
- canonical AGPL-3.0-only full license text；
- macOS 主开发命令稳定；
- Windows CI 至少能完成 install / typecheck / test / build/smoke。

M0 不实现真实 GSI domain、HUD、Radar 或 RivalHub uplink。

### M1 — 运行时验证

目标：证明真实 CS2 GSI 可以通过生产数据链稳定进入 Runtime，并被记录、重放和测试。

关键能力：

- Raw GSI ingress；
- GSI parser / adapter 决策；
- `NormalizedTelemetry`；
- recorder + fixture format；
- replay clock / replay runner；
- RuntimeState skeleton；
- producer/session/map epoch/time primitives；
- basic latest-wins delivery；
- `/debug` projection；
- 第一份真实 Windows + CS2 capture → Mac/CI replay acceptance。

进入主要实现前应补 `docs/telemetry.md`。

M1 的平台无关实现不等待 Windows 环境恢复；真实 CS2 capture / acceptance 通过独立 Windows validation lane 补齐。

### M2 — 本地制播内核

目标：不依赖 RivalHub 在线服务，也能稳定驱动一场本地比赛的基础节目画面。

关键能力：

- local match-context fixture；
- identity resolver / side mapping；
- basic Gameplay HUD；
- player + bomb Radar；
- local browser realtime transport；
- reconnect / baseline snapshot；
- slow-consumer latest-wins backpressure；
- wrong-match / degraded capability；
- macOS OBS Browser Source early smoke；
- Windows OBS Browser Source production-path smoke；
- accelerated long replay / soak。

进入主要实现前应补 local `docs/protocol.md`。

### M3 — 制播工作流

目标：从基础 HUD 进化为完整本地赛事节目工作流。

关键能力：

- Waiting / Matchup / VetoPlayback；
- BaseScene + OverlayCue engine；
- operator auto/manual control；
- grenade / smoke / inferno Radar；
- provisional KDA / ADR / round history；
- Halftime / MapResult / InterMap / MatchResult；
- production-oriented Radar presentation。

进入相关实现前按需要补 `docs/scene-engine.md` 与 `docs/radar.md`。

### M4 — RivalHub 集成

目标：通过正式 versioned contract 接入 RivalHub，而不破坏 local-first 与 authority boundary。

关键能力：

- browser pairing / scoped producer credential；
- BroadcastManifest；
- `ReliableObservation` → RivalHub #610；
- bounded durable observation outbox；
- `BroadcastLiveSnapshot` → RivalHub #615；
- cloud throttle / coalesce；
- idempotency / stale session / stale epoch guards；
- wrong-match fail closed；
- connection/re-auth health。

M4 开始前 `docs/security.md` 与 RivalHub-facing `docs/protocol.md` 是 blocking design work。

### M5 — 生产就绪与赛前验收

目标：从“工程上可运行”变成“真实赛事电脑可以重复部署、长时间运行并安全恢复”。

关键能力：

- Windows packaging / launcher；
- GSI config installation；
- local cache / recovery checkpoint；
- structured logs / diagnostics bundle；
- credential storage；
- startup / shutdown / restart recovery；
- Radar/program assets packaging；
- real Windows + CS2 spectator + OBS acceptance；
- wall-clock soak；
- production runbook；
- 完整 BO3/等价长时 rehearsal；
- 赛前 feature freeze 与 fallback validation。

进入发布前应补 `docs/testing.md`、`docs/operations.md` 与 packaging ADR。

## Platform validation lane

平台验证不单独成为“Windows 团队拥有的功能模块”，而是横跨 M0–M5 的验证 lane：

```text
Mac / Agent implementation
        ↓
Deterministic tests
        ↓
GitHub Actions macOS + Windows（按 Issue 要求）
        ↓
需要时：Windows + CS2 / OBS validator
        ↓
Acceptance evidence
```

每个 execution Issue 必须声明：

1. Implementation environment；
2. Automated validation；
3. Real-environment acceptance gate。

详见 `docs/development-validation.md`。

当前 Windows 主开发机暂不可用并不阻塞 M0/M1/M2 的平台无关工作；需要真实 CS2/OBS 的验收项应明确标记为 pending，而不是让整个开发主线停住。

## Future / Post-v1

不进入 M0–M5 critical path：

- exact damage-source telemetry；
- server game-event adapter；
- baked C4 damage provider；
- observer advisory / auto director；
- OBS WebSocket 深度控制；
- replay automation；
- telestrator；
- Stream Deck；
- MulNX / HLAE；
- renderer SDK / third-party HUD compatibility；
- plugin marketplace。

## Issue 生命周期

```text
idea
  ↓
needs-design
  ↓
设计 / 调研完成
  ↓
agent-ready
  ↓
in-progress
  ↓
review
  ↓
done
```

`agent-ready` 的含义不是“有一个标题”，而是：

- Objective 明确；
- Canonical decisions 已冻结；
- Scope / Non-goals 明确；
- implementation plan 已基于真实仓库结构；
- tests / acceptance criteria 可验证；
- dependencies 已知；
- platform/validation gate 已知；
- Agent 不需要重新做产品或架构决策。

## 建议 Labels

仓库标签只表达一个维度，避免过度分类。

状态：

```text
needs-design
agent-ready
blocked
needs-windows-validation
```

领域：

```text
area:foundation
area:core
area:telemetry
area:web
area:radar
area:rivalhub
area:testing
area:ops
area:docs
```

类型：

```text
type:feature
type:bug
type:architecture
type:chore
```

`needs-windows-validation` 只表示尚欠真实 Windows/CS2/OBS 证据，不等同 `blocked`。如果代码开发和普通 CI 仍可继续，不应标记整个 Issue 为 blocked。

优先级只有真正需要排序时再使用 `P0/P1/P2`，Milestone 本身不等同优先级。

## GitHub Project 建议视图

Project 名称：`RivalHub Broadcast`

建议至少三个 View：

1. `执行`：Board，按 `Backlog / Ready / In Progress / Review / Done`；
2. `路线图`：按 M0–M5 / Milestone 查看；
3. `架构与依赖`：筛选 `needs-design`、`blocked`、`type:architecture`，并纳入 RivalHub #610 / #615 等跨仓依赖。

建议 Project 增加：

```text
Platform gate
  None
  Windows CI
  Real Windows
  Windows + CS2
  Windows + OBS
  Windows + CS2 + OBS

Platform validation
  Not required
  Pending
  Passed
  Failed
```

Project 只组织链接到 Issue/PR 的工作，不复制规格正文。
