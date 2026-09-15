# RivalHub Broadcast

RivalHub Broadcast 是面向 RivalHub 赛事体系的 **CS2 本地制播运行时（Broadcast Runtime）**。

它不是第二套赛事后台，也不只是一个 Gameplay HUD。项目目标是让赛事信息在 RivalHub 中维护一次，然后围绕同一场 Match 完成赛前展示、BP 播放、比赛中 HUD 与 Radar、中场与场间页面、赛后结果展示，以及安全的实时状态回传。

正式节目只消费 **Delayed Program** 时间轴；可选的 no-delay Lookahead 输入只作为 machine-only Observer Assist evidence，不进入 OBS Program 或公开实时状态。具体 provider、延迟值与 acquisition 方式属于运行配置/RFC，而不是 Core invariant。

> 当前仓库已完成产品、authority、Runtime/Workspace、真实 GSI semantics 与 Program/Assist 边界的基线冻结；实施按 M0–M5 的可验证 vertical slice 推进。

## 产品目标

一场正常比赛的目标流程：

```text
RivalHub 准备比赛
Roster / Schedule / BP / Branding
        ↓
Broadcast 加载 Match 上下文
        ↓
Waiting / Matchup / BP Playback
        ↓
Gameplay HUD + Radar
        ↓
Halftime
        ↓
Map Result / Inter-map
        ↓
下一张地图 / Match Result
        ↓
ReliableObservation → RivalHub #610
BroadcastLiveSnapshot → RivalHub #615
        ↓
OCR / DAK / 管理员异常处理
```

本机还可以并行运行：

```text
No-delay Lookahead source
→ headless event parser
→ timeline alignment
→ future kill cue
→ private Observer Assist Overlay
→ 解说兼 OB 手动切 POV
```

核心原则：

- **RivalHub 是官方赛事事实的长期权威来源。** Broadcast 不建立第二套 Team / Player / Match / BP 数据库。
- **Broadcast 是本地实时制播运行时。** GSI、Radar、场景、临时统计、节目状态和诊断属于本仓库。
- **实时观测不等于官方事实。** Broadcast 提交 ReliableObservation 与 BroadcastLiveSnapshot；RivalHub 决定 canonical truth 和 public projection。
- **本地优先。** RivalHub 暂时不可达时，已经加载的 HUD / Radar / 场景仍应继续工作。
- **Program 与 Observer Assist 硬隔离。** Lookahead future information 不进入 `/program`、官方 OBS Program preset 或 #615。
- **面向完整节目流程设计。** Gameplay HUD 只是其中一个 BaseScene。
- **先建立可靠内核，再逐步打磨视觉。** 高级效果可以后置，但基础架构不能把它们堵死。

## 场景与临时效果

BaseScene 的目标集合包括：

```text
Waiting
Matchup
VetoPlayback
Gameplay
Halftime
MapResult
InterMap
MatchResult
Break
Emergency
```

临时节目反馈使用 OverlayCue，而不是无限扩张 scene enum，例如：

```text
Clutch
Ace
MultiKill
DamageFeedback
BombUrgency
Timeout
TechnicalWarning
```

`TechnicalPause` 可以根据实际节目设计成为 Gameplay overlay 或独立完整画面。BP/Veto 的官方数据来自 RivalHub；Broadcast 只负责把已经完成的 BP 作为节目时间线播放，不建立第二套实时 veto domain。Observer Assist cue 不属于 Program OverlayCue；它是私有辅助输出，不能进入 Program scene graph。

## 关键能力方向

- RivalHub Match / Roster / BP / Schedule / Branding 接入；
- CS2 GSI 接收、标准化和身份匹配；
- 单一 RuntimeState aggregate + Program/Radar/ObserverAssist/Operator/Debug/BroadcastLiveSnapshot consumer projections；
- Program-safe 与 Assist-private runtime data 结构化分区；
- RuntimeTransition + transition-time context 派生 ReliableObservation；
- 高频 current snapshot latest-wins + 明确 boundary transition，而不是万能 EventJournal；
- Program / Lookahead 独立 source continuity + timeline alignment；
- 高性能 Gameplay HUD；
- 可配置 Radar：选手编号/头像、自定义 marker、道具、烟火、轨迹、上下层；
- KDA、ADR、round history 等直播临时统计；
- scene suggestion + operator 手动控制；
- 中场、场间、赛后数据页面；
- 基础 Observer Assist：未来击杀 countdown + killer→victim + 可可靠获得的位置；
- wrong-match、断流、重连、离线 cache 与恢复；
- latest-wins backpressure、ReliableObservation outbox；
- record/replay fixture、fault injection、slow-consumer test、长时间 soak test；
- 向 RivalHub #610 提供 ReliableObservation；
- 向 RivalHub #615 提供低频 BroadcastLiveSnapshot；
- 为 server game events、C4 生存预测、OBS 深度控制、MulNX/HLAE、Replay、Camera 等高级能力保留 adapter/capability 接缝。

详细产品需求见 [`docs/product.md`](docs/product.md)。阶段实施计划见 [`docs/roadmap.md`](docs/roadmap.md)。开发与平台验收边界见 [`docs/development-validation.md`](docs/development-validation.md)。

## 仓库边界

```text
RivalHub
  官方赛事上下文 / lifecycle / canonical result
        │
        ▼
RivalHub Broadcast
  本地 telemetry / RuntimeState / scenes / HUD / radar / diagnostics
        │
        ▼
OBS / Program

赛后：Demo → DAK → RivalHub evidence / confirmation
```

跨仓 ownership：

```text
BroadcastManifest             RivalHub → Broadcast
ReliableObservation           Broadcast → RivalHub #610
BroadcastLiveSnapshot         Broadcast → RivalHub #615
EphemeralLiveProjection       RivalHub #615 server-side
PublicLiveMatchProjection     RivalHub public read model
```

本仓库只依赖稳定、版本化的 integration contract，不依赖 RivalHub 内部数据库结构、React 页面或源码类型。

实现顺序上，`BroadcastManifest` 读侧 contract/fixture 会在本地 Program 工作流阶段提前验证；真正的 pairing/auth、ReliableObservation 与 BroadcastLiveSnapshot uplink 在本地 runtime 稳定后再进入生产写路径。M3 内部把 **Program workflow** 与 **Observer Assist** 当成两个独立 vertical slice：共享 Runtime/identity 基础，但 Assist 的 bug、断流或验证延迟不能阻塞正常 Program 主链。

## 目录与 ownership

```text
apps/
  companion/            本地 runtime / composition root
  web/                  Operator / Program / Debug；Observer Assist 可接独立 surface
packages/
  protocol/             Broadcast-owned local wire protocol
  core/                 RuntimeState / identity / transitions / accumulators / projectors
  telemetry-gsi/        GSI adapter
  rivalhub/             RivalHub contract adapter / uplink
  radar/                framework-neutral Radar domain / geometry / interpolation
  testkit/              capture reader / simulator / replay / fault injection
docs/                   中文产品、架构与决策文档
fixtures/               可复现测试数据
```

production recorder 属于 Companion/telemetry runtime；`testkit` 只消费 capture 做 replay/simulator/fault injection。Presentation implementation 默认留在 `apps/web`；只有出现第二个真实 renderer consumer 或独立发布需求时再抽独立 package/API boundary。

## 文档与实施

- [`docs/product.md`](docs/product.md)：产品需求基线。
- [`docs/architecture.md`](docs/architecture.md)：已确定的架构边界与待决事项。
- [`docs/telemetry.md`](docs/telemetry.md)：基于真实 capture 的 GSI/source semantics、capture/replay 设计基线。
- [`docs/roadmap.md`](docs/roadmap.md)：M0–M5 阶段交付与 Issue/Project 组织方式。
- [`docs/development-validation.md`](docs/development-validation.md)：开发、跨平台自动验证与 Windows + CS2/CSTV + OBS 真实验收模型。
- [`docs/references.md`](docs/references.md)：参考 HUD / 制播项目的取舍。
- [`docs/decisions/0001-project-positioning-and-authority.md`](docs/decisions/0001-project-positioning-and-authority.md)：项目定位与 authority。
- [`docs/decisions/0002-runtime-workspace-technology-baseline.md`](docs/decisions/0002-runtime-workspace-technology-baseline.md)：Runtime / Workspace 技术基线。
- [`docs/decisions/0003-runtime-state-delivery-invariants.md`](docs/decisions/0003-runtime-state-delivery-invariants.md)：RuntimeState、identity、delivery/backpressure、outbox 与跨仓 contract invariant。
- [`docs/decisions/0004-program-output-and-observer-assist-isolation.md`](docs/decisions/0004-program-output-and-observer-assist-isolation.md)：Program、machine-only Lookahead 与 Observer Assist 的隔离边界。
- [`docs/decisions/0005-product-capability-boundaries-and-portability.md`](docs/decisions/0005-product-capability-boundaries-and-portability.md)：产品能力线、Shared Runtime Foundation、RivalHub 第一方集成与可移植性边界。
- [`AGENTS.md`](AGENTS.md)：面向开发 Agent 的仓库工作原则。
- [`CONTRIBUTING.md`](CONTRIBUTING.md)：Issue-driven / agent-assisted 开发与 PR 交付规范。

仓库的一手文档默认使用中文。长期文档记录稳定产品语义、架构 invariant、evidence-backed source facts 与阶段目标；单个 PR 的临时实现过程、当前机器状态、短期排期和一次性调试记录留在 Issue/PR/Project，不沉淀为长期规范。代码或 contract 改变了文档描述的事实时，同一 PR 必须同步更新相关文档。

## License

RivalHub Broadcast 使用 **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**。

根 `LICENSE` 已按 FSF/SPDX canonical full text 写入完整 AGPL-3.0-only，许可证正文未作项目自定义改写。第三方依赖与参考项目的许可证边界单独记录在 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。