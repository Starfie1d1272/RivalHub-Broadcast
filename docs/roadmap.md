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

## 路线设计原则

M0–M5 按“先证明输入与运行时 → 再证明本地节目 → 再补完整工作流与 Assist → 再开放写入/uplink → 最后生产硬化”的顺序推进。

产品能力按 ADR-0005 分成三条线，但路线图不据此拆成三套独立项目：

```text
Shared Runtime Foundation
  M0 / M1 为主，之后持续硬化
        │
        ├─ 赛事与实时数据
        │    M2 冻结 read-side consumer contract
        │    M3-A 用真实只读赛事上下文跑完整节目
        │    M4 接入 ReliableObservation / BroadcastLiveSnapshot / auth / outbox
        │
        ├─ 正式节目制播
        │    M2 建立本地 Gameplay / Radar / projections
        │    M3-A 完成完整 Program workflow
        │    M5 完成正式赛事部署与恢复
        │
        └─ Observer Assist / Lookahead
             M1/M2 只保留隔离与 adapter seam
             M3-B 完成最小确定性 future kill cue
             M5 完成真实环境 non-leak / recovery 验收
```

这张映射表达的是产品能力 ownership，不改变 milestone 的依赖顺序，也不要求每条能力拥有独立 package、进程或仓库。

需要特别区分 RivalHub 的**读路径**与**写路径**：

```text
RivalHub read path
  BroadcastManifest / Match / Roster / BP / Branding
  → 是完整节目工作流的基础输入
  → 必须在 M2/M3 提前验证

RivalHub write/uplink path
  ReliableObservation / BroadcastLiveSnapshot / auth / outbox
  → 可以在本地 Program 已稳定后于 M4 正式接入
```

不能等到 M4 才第一次让完整节目面对真实 RivalHub 数据，否则会把 manifest shape、identity、缓存与 scene 数据需求的跨仓风险推得过晚。

同时，`RivalHub-native` 不等于 Shared Runtime / Radar / Lookahead 必须 import RivalHub 内部类型或在线服务。路线实施时优先通过 `packages/rivalhub`、Broadcast-owned contract 与本地 same-shape fixture 保持第一方集成深度和可移植性，而不是为了“通用”提前设计插件系统。

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

目标：证明真实 CS2 GSI 可以通过生产数据链稳定进入 Runtime，并被记录、重放和测试。该阶段主要建立三条产品能力共享的 Runtime Foundation，不为某一条 surface 私有化基础语义。

关键能力：

- Raw GSI ingress；
- GSI parser / adapter 决策；
- `NormalizedTelemetry`；
- production recorder + fixture format；
- replay clock / replay runner；
- RuntimeState skeleton；
- producer/session/map epoch/time primitives；
- source-local sequence/continuity 的基本语义；
- basic latest-wins delivery；
- `/debug` projection；
- 真实 Windows + CS2 capture → Mac/CI replay acceptance；
- 基于真实 capture 的 block-specific GSI semantics。

`docs/telemetry.md` 已作为 evidence-backed M1 baseline；平台无关实现不等待正式 GOTV 或主 Windows 开发机恢复。

M1 只需为未来 Lookahead input 保留干净 adapter/capability seam，不在这里实现 CSTV Observer Assist。

### M2 — 本地制播内核

目标：不依赖 RivalHub 在线服务，也能稳定驱动一场本地比赛的基础节目画面；同时提前冻结“真实赛事上下文如何进入本地 runtime”的读侧 contract，避免到 M4 才发现跨仓 shape 不合适。

M2 主要推进**正式节目制播**的本地内核，同时为**赛事与实时数据**建立 read-side contract，并为 **Observer Assist** 固定类型隔离 seam。

关键能力：

- `BroadcastManifest` consumer contract / validator 的第一版；
- 与该 contract 同 shape 的 local match-context fixture；
- last-known-good match context/cache seam；
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

M2 的 `BroadcastManifest` 不要求此时完成最终 pairing/auth 或所有服务端 API，但 fixture/schema 必须来自真实 #613 consumer 需求，而不是发明一套以后再迁移的临时 MatchContext。

进入主要实现前应补 local `docs/protocol.md`，明确 consumer-specific DTO，而不是一个包含所有字段的通用 payload。

### M3 — 完整制播工作流 + Observer Assist

目标：从基础 HUD 进化为完整本地赛事节目工作流，并落地当前 Major 真正有价值的最小 Lookahead Assist。

M3 执行上明确分成两个**独立可验收 vertical slice**；二者共享 Runtime/identity 基础，但任何 Assist 故障都不能拖死 Program 主线。

#### M3-A Program workflow

M3-A 是**正式节目制播**能力线的完整 workflow slice，同时通过真实只读 RivalHub context 验证**赛事与实时数据**能力线的 ingress。

关键能力：

- 使用真实 RivalHub read-only `BroadcastManifest` 跑一场比赛上下文；
- RivalHub 暂时不可达时可继续使用 last-known-good context；
- Waiting / Matchup / VetoPlayback；
- BaseScene + OverlayCue engine；
- operator auto/manual control；
- grenade / smoke / inferno Radar；
- provisional KDA / ADR / round history；
- Halftime / MapResult / InterMap / MatchResult；
- production-oriented Radar presentation；
- OBS Program preset 的一键创建 / 校验 / 修复。

#### M3-B Observer Assist

M3-B 是 **Observer Assist / Lookahead** 能力线的第一条完整 vertical slice。它仍运行在同一 Runtime Foundation 上，但 acquisition、alignment 和 cue contract 不以 RivalHub Web/domain implementation 作为算法前提。

关键能力：

- Perfect dual-GOTV discovery/configuration（provider-specific，不污染 Core）；
- no-delay headless event parsing；
- Program / Lookahead 各自独立 source health / generation；
- no-delay ↔ delayed Program tick/alignment health；
- source reconnect / generation change 后旧 alignment 立即失效；
- **基础 future kill cue：countdown + killer → victim + optional reliable location**；
- topmost / transparent Observer Assist surface，供同一个解说兼 OB 看；
- Assist future fields 不进入 Program/#615/官方 OBS preset；
- Lookahead failure 只关闭 Assist，不影响 Program。

进入相关实现前按需要补 `docs/scene-engine.md`、`docs/radar.md` 与 OBS/Assist 运行文档。

M3 的基础完成条件**不包括**：

- 佯攻 / 主攻识别；
- engagement/story classification；
- 复杂 importance ranking；
- AI / model prediction；
- full-auto observer / auto TAKE；
- MulNX actuator；
- 复杂 OBS scene orchestration；
- 为未来独立产品提前拆分 Lookahead 仓库或建立通用 plugin SDK。

这些只有在真实比赛使用证明基础 kill cue 需要增强后再排期。

### M4 — RivalHub Uplink、Auth 与生产写路径

目标：在真实 RivalHub read path 已经被 Program workflow 验证后，通过正式 versioned contract 接入认证、可靠 observation 和 public live uplink，而不破坏 local-first 与 authority boundary。

M4 是**赛事与实时数据**能力线从“消费 canonical context”走向“产生标准 live/reliable output”的关键阶段。Broadcast 仍只是 producer；公开网站、SSE/WebSocket/Realtime/REST 或未来第三方数据分发由 RivalHub / 对应云端服务 owner 负责。

关键能力：

- browser pairing / scoped producer credential；
- `BroadcastManifest` authenticated refresh / revision / cache hardening；
- MatchRoster / Steam64 自动核验与真实服务端 context 联调；
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

目标：从“工程上可运行”变成“真实赛事电脑可以重复部署、长时间运行并安全恢复”。M5 对三条产品能力线做统一生产验收，而不是第一次把任一能力放到真实环境。

关键能力：

- Windows production packaging / launcher；
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

M5 是**生产硬化**，不是第一次把软件放到 Windows 上。M2/M3 的真实平台 smoke 必须已经通过可复现的 runnable artifact/start workflow 执行；否则最终 packaging 风险会被错误推迟到发布前。

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
可复现的 Windows runnable artifact / start workflow
        ↓
需要时：Windows + CS2 / OBS validator
        ↓
Acceptance evidence
```

每个 execution Issue 必须声明：

1. Implementation environment；
2. Automated validation；
3. Real-environment acceptance gate。

对需要真实 Windows 验证的功能，validator 应尽量运行明确 commit/build 对应的 artifact 或标准 start workflow，而不是在测试机上临时改代码；这样真实验收结果才能与仓库 revision 对应。

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
- plugin marketplace；
- 独立 Lookahead / live-data 产品仓库或通用 esports adapter framework。

注意：**基础 Observer Assist future kill cue** 已进入当前 Major 的 V1/P1 路径；只有更重的叙事理解和自动导播继续属于 Future。未来是否独立 packaging 需要第二个真实 provider/consumer 或明确发行需求证明，不因“可能商业化”自动进入当前 critical path。

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