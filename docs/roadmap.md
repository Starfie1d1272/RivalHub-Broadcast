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
- production recorder + fixture format；
- replay clock / replay runner；
- RuntimeState skeleton；
- producer/session/map epoch/time primitives；
- basic latest-wins delivery；
- `/debug` projection；
- 真实 Windows + CS2 capture → Mac/CI replay acceptance；
- 基于真实 capture 的 block-specific GSI semantics。

`docs/telemetry.md` 已作为 evidence-backed M1 baseline；平台无关实现不等待正式 GOTV 或主 Windows 开发机恢复。

M1 只需为未来 Lookahead input 保留干净 adapter/capability seam，不在这里实现 CSTV Observer Assist。

### M2 — 本地制播内核

目标：不依赖 RivalHub 在线服务，也能稳定驱动一场本地比赛的基础节目画面。

关键能力：

- local match-context fixture；
- identity resolver / Steam64 roster mapping / side mapping；
- basic Gameplay HUD；
- player + bomb Radar；
- local browser realtime transport；
- ProgramProjection / OperatorProjection / DebugProjection 分离；
- ObserverAssistProjection 的最小 schema seam，确保 future fields 从 Program 类型层就不可见；
- reconnect / baseline snapshot；
- slow-consumer latest-wins backpressure；
- wrong-match / roster-mismatch / degraded capability；
- macOS OBS Browser Source early smoke；
- Windows OBS Browser Source production-path smoke；
- accelerated long replay / soak。

进入主要实现前应补 local `docs/protocol.md`，明确 consumer-specific DTO，而不是一个包含所有字段的通用 payload。

### M3 — 完整制播工作流 + Observer Assist

目标：从基础 HUD 进化为完整本地赛事节目工作流，并落地当前 Major 真正有价值的最小 Lookahead Assist。

关键能力：

- Waiting / Matchup / VetoPlayback；
- BaseScene + OverlayCue engine；
- operator auto/manual control；
- grenade / smoke / inferno Radar；
- provisional KDA / ADR / round history；
- Halftime / MapResult / InterMap / MatchResult；
- production-oriented Radar presentation；
- Perfect dual-GOTV discovery/configuration（provider-specific，不污染 Core）；
- no-delay headless event parsing；
- no-delay ↔ delayed Program tick/alignment health；
- **基础 future kill cue：countdown + killer → victim + optional reliable location**；
- topmost / transparent Observer Assist surface，供同一个解说兼 OB 看；
- Assist future fields 不进入 Program/#615/官方 OBS preset；
- Lookahead failure 只关闭 Assist，不影响 Program；
- OBS Program preset 的一键创建 / 校验 / 修复。

进入相关实现前按需要补 `docs/scene-engine.md`、`docs/radar.md` 与 OBS/Assist 运行文档。

M3 的基础完成条件**不包括**：

- 佯攻 / 主攻识别；
- engagement/story classification；
- 复杂 importance ranking；
- AI / model prediction；
- full-auto observer / auto TAKE；
- MulNX actuator；
- 复杂 OBS scene orchestration。

这些只有在真实比赛使用证明基础 kill cue 需要增强后再排期。

### M4 — RivalHub 集成

目标：通过正式 versioned contract 接入 RivalHub，而不破坏 local-first 与 authority boundary。

关键能力：

- browser pairing / scoped producer credential；
- BroadcastManifest；
- MatchRoster / Steam64 自动核验；
- MatchPreparation / ObservationHealth 边界消费；
- `ReliableObservation` → RivalHub #610；
- `match_started / map_started / map_ended / series_ended` 等可靠 observation；
- bounded durable observation outbox；
- `BroadcastLiveSnapshot` → RivalHub #615；
- #615 只来自 Delayed Program timeline；
- cloud throttle / coalesce；
- idempotency / stale session / stale epoch guards；
- wrong-match / roster mismatch fail closed；
- connection/re-auth health。

no-delay Lookahead feed 是否未来成为更早 #610 observation source **不因 M3 已接入而自动成立**；如确有业务价值，必须在本 milestone 的 RivalHub-facing contract 中单独冻结。

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
- Observer Assist topmost/click-through 与 official Program capture non-leak；
- Lookahead wrong-match / alignment loss / reconnect rehearsal；
- OBS preset repair 与 obs-websocket unavailable degradation；
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

第一批真实 Windows + CS2 observer capture 已经获得并写入 `docs/telemetry.md` 的 evidence baseline；这不等于 Lookahead CSTV / topmost overlay 已完成生产验收。后者仍需独立真实环境验证。

## Future / Post-v1

不进入 M0–M5 critical path：

- exact damage-source telemetry；
- server game-event adapter；
- baked C4 damage provider；
- engagement/story classification；
- AI / model prediction advisory；
- full-auto observer / auto TAKE；
- OBS WebSocket 深度 scene orchestration；
- replay automation；
- telestrator；
- Stream Deck；
- MulNX / HLAE；
- renderer SDK / third-party HUD compatibility；
- plugin marketplace。

注意：**基础 Observer Assist future kill cue** 已进入当前 Major 的 V1/P1 路径；只有更重的叙事理解和自动导播继续属于 Future。

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
3. `架构与依赖`：筛选 `needs-design`、`blocked`、`type:architecture`，并纳入 RivalHub #610 / #613 / #615 等跨仓依赖。

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
