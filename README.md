# RivalHub Broadcast

RivalHub Broadcast 是面向 RivalHub 赛事体系的 **CS2 本地制播运行时（Broadcast Runtime）**。

它不是第二套赛事后台，也不只是一个 Gameplay HUD。项目目标是让赛事信息在 RivalHub 中维护一次，然后围绕同一场 Match 完成赛前展示、BP 播放、比赛中 HUD 与 Radar、中场与场间页面、赛后结果展示、Observer Assist、OBS 集成，以及安全的实时状态回传。

> 当前仓库已经完成工程/架构基线，并用真实 Windows + CS2 capture 修正了 M1 telemetry source semantics。接下来按 Roadmap 推进 Runtime、节目工作流、Observer Assist 与 RivalHub integration，而不是继续无边界扩张设计。

## 产品目标

当前 Major 的真实现场模型是**单机、单人解说兼 OB**。同一个人在延迟 GOTV 上解说和手动切 POV；OBS 捕获这一条正式节目时间轴。Perfect 同场提供的无延迟 GOTV 不给人直接观看，只作为 machine-only lookahead input，为本机 Assist Overlay 提供未来击杀提示。

```text
RivalHub 准备比赛
Roster / Schedule / BP / Branding
        ↓
Broadcast 加载 Match 上下文
        ↓
Waiting / Matchup / BP Playback
        ↓
Delayed Program GOTV → CS2 + Gameplay HUD + Radar
        │
        ├────────────→ OBS → 观众
        │
        └→ Program live state → RivalHub #610 / #615（按各自 contract）

No-delay Lookahead GOTV
        ↓ machine-only headless parse
Timeline alignment
        ↓
本机 Observer Assist Overlay（不进 OBS）
        ↓
解说兼 OB 提前手动切 POV
```

核心原则：

- **RivalHub 是官方赛事事实的长期权威来源。** Broadcast 不建立第二套 Team / Player / Match / BP 数据库。
- **Broadcast 是本地实时制播运行时。** GSI、Radar、场景、临时统计、节目状态、Observer Assist 和诊断属于本仓库。
- **实时观测不等于官方事实。** Broadcast 提交 ReliableObservation 与 BroadcastLiveSnapshot；RivalHub 决定 canonical truth 和 public projection。
- **Delayed Program feed 是唯一正式节目输入。** no-delay Lookahead feed 只做机器辅助，不具备 Program eligibility，也不参与 Program fallback。
- **Observer Assist 是本机私有显示层。** future cue 不得进入 Program、官方 OBS preset 或 #615 public live projection。
- **本地优先。** RivalHub 暂时不可达时，已经加载的 HUD / Radar / 场景仍应继续工作。
- **面向完整节目流程设计。** Gameplay HUD 只是其中一个 BaseScene。
- **先建立可靠内核，再逐步打磨视觉。** 高级效果可以后置，但第一版架构不能把它们堵死。

## Observer Assist

第一阶段只解决一个确定性问题：**提前约 10 秒告诉解说兼 OB 下一次击杀是谁杀谁，帮助其提前切到相关 POV。**

```text
No-delay GOTV 观察到 player_death
→ attacker / victim / event tick / optional reliable location
→ 与 delayed Program tick 对齐
→ 约 T-10s 显示本地透明提示
→ 人手动切 POV
```

第一阶段不要求识别佯攻/主攻、理解故事线、复杂 engagement ranking、AI prediction 或自动 TAKE。这些可以在真实使用证明有价值后再逐步增强。

## 场景与临时效果

当前 BaseScene：

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

`TechnicalPause` 可以根据实际节目设计成为 Gameplay overlay 或独立完整画面。

其中 BP/Veto 的官方数据来自 RivalHub；Broadcast 只负责把已经完成的 BP 作为节目时间线播放，不建立第二套实时 veto domain。

## 关键能力方向

- RivalHub Match / Roster / BP / Schedule / Branding 接入；
- CS2 GSI 接收、block-specific source semantics、标准化和身份匹配；
- MatchRoster / Steam64 ↔ observed players 自动核验；
- 单一 RuntimeState + Program/Radar/ObserverAssist/Operator/Debug/BroadcastLiveSnapshot consumer projections；
- RuntimeTransition + transition-time context 派生 ReliableObservation；
- 高性能 Gameplay HUD；
- 可配置 Radar：选手编号/头像、自定义 marker、道具、烟火、轨迹、上下层；
- KDA、ADR、round history 等直播临时统计；
- scene suggestion + operator 手动控制；
- 中场、场间、赛后数据页面；
- no-delay lookahead → future kill cue → 本地 Observer Assist Overlay；
- wrong-match、roster mismatch、断流、重连、离线 cache 与恢复；
- latest-wins backpressure、ReliableObservation outbox；
- record/replay fixture、slow-consumer test、长时间 soak test；
- 向 RivalHub #610 提供 ReliableObservation；
- 向 RivalHub #615 提供低频 Delayed Program timeline 的 BroadcastLiveSnapshot；
- 官方 OBS Program preset 的一键创建 / 校验 / 修复；
- 为 server game events、C4 生存预测、OBS 深度控制、MulNX/HLAE、Replay、Camera 等高级能力保留 adapter/capability 接缝。

详细产品需求见 [`docs/product.md`](docs/product.md)。阶段实施计划见 [`docs/roadmap.md`](docs/roadmap.md)。开发与平台验收边界见 [`docs/development-validation.md`](docs/development-validation.md)。

## 仓库边界

```text
RivalHub
  官方赛事上下文 / lifecycle / canonical result
        │
        ▼
RivalHub Broadcast
  本地 telemetry / RuntimeState / scenes / HUD / radar / observer assist / diagnostics
        │
        ├─ Program → OBS
        └─ Observer Assist → 本机私有 overlay

赛后：Demo → DAK → RivalHub evidence / confirmation
```

跨仓 ownership：

```text
BroadcastManifest             RivalHub → Broadcast
ReliableObservation           Broadcast → RivalHub #610
BroadcastLiveSnapshot         Broadcast → RivalHub #615（Delayed Program timeline）
EphemeralLiveProjection       RivalHub #615 server-side
PublicLiveMatchProjection     RivalHub public read model
```

本仓库只依赖稳定、版本化的 integration contract，不依赖 RivalHub 内部数据库结构、React 页面或源码类型。

## 初始目录规划

```text
apps/
  companion/            本地 runtime / composition root / production capture / integrations
  web/                  Operator / Program / Debug；Observer Assist surface/overlay 按实现 Issue 接入
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

production capture recorder 属于 Companion/telemetry runtime，不属于 `packages/testkit`；testkit 只消费 capture 做 replay/simulation/test。

第一套 Major renderer 直接留在 `apps/web` presentation 内；只有出现第二个真实 renderer consumer 或独立发布需求时再抽独立 package/API boundary。

## OBS production integration

官方 Program preset 至少包含：

```text
RivalHub Program Scene
├─ CS2 Program Capture（Delayed GOTV）
├─ /program Browser Source
└─ Program-safe assets
```

不得包含 Observer Assist surface/window。obs-websocket/control channel 可以负责创建、校验、修复与未来可选 scene control，但控制通道断开后已经建立的 `/program` 必须继续工作。

## 文档与实施

- [`docs/product.md`](docs/product.md)：产品需求基线。
- [`docs/architecture.md`](docs/architecture.md)：已确定的架构边界与待决事项。
- [`docs/telemetry.md`](docs/telemetry.md)：M1 GSI / capture / replay 的 evidence-backed source semantics。
- [`docs/roadmap.md`](docs/roadmap.md)：M0–M5 阶段交付与 Issue/Project 组织方式。
- [`docs/development-validation.md`](docs/development-validation.md)：macOS 主开发、跨平台自动验证与 Windows + CS2 + OBS 真实验收模型。
- [`docs/references.md`](docs/references.md)：参考 HUD / 制播项目的取舍。
- [`docs/decisions/0001-project-positioning-and-authority.md`](docs/decisions/0001-project-positioning-and-authority.md)：项目定位与 authority。
- [`docs/decisions/0002-runtime-workspace-technology-baseline.md`](docs/decisions/0002-runtime-workspace-technology-baseline.md)：Runtime / Workspace 技术基线。
- [`docs/decisions/0003-runtime-state-delivery-invariants.md`](docs/decisions/0003-runtime-state-delivery-invariants.md)：RuntimeState、identity、delivery/backpressure、outbox 与跨仓 contract invariant。
- [`docs/decisions/0004-program-output-and-observer-assist-isolation.md`](docs/decisions/0004-program-output-and-observer-assist-isolation.md)：Delayed Program、machine-only Lookahead、Observer Assist 与 non-leak/fallback 边界。
- [`AGENTS.md`](AGENTS.md)：面向开发 Agent 的仓库工作原则。
- [`CONTRIBUTING.md`](CONTRIBUTING.md)：Issue-driven / agent-assisted 开发与 PR 交付规范。

仓库的一手文档默认使用中文。代码标识符、协议字段、第三方项目名与行业术语在更清晰时保留英文。

## License

RivalHub Broadcast 使用 **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**。

根 `LICENSE` 已按 FSF/SPDX canonical full text 写入完整 AGPL-3.0-only，许可证正文未作项目自定义改写。

第三方依赖与参考项目的许可证边界单独记录在 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。
