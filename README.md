# RivalHub Broadcast

RivalHub Broadcast 是面向 RivalHub 赛事体系的 **CS2 本地制播运行时（Broadcast Runtime）**。

它不是第二套赛事后台，也不只是一个 Gameplay HUD。项目目标是让赛事信息在 RivalHub 中维护一次，然后围绕同一场 Match 完成赛前展示、BP 播放、比赛中 HUD 与 Radar、中场与场间页面、赛后结果展示，以及安全的实时状态回传。

> 当前仓库处于架构与产品基线初始化阶段。实现前先冻结产品需求、权威边界和核心协议；视觉样式与高级制播能力随后逐步实现。

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
Live Projection / Result Candidate → RivalHub
        ↓
OCR / DAK / 管理员异常处理
```

核心原则：

- **RivalHub 是官方赛事事实的长期权威来源。** Broadcast 不建立第二套 Team / Player / Match / BP 数据库。
- **Broadcast 是本地实时制播运行时。** GSI、Radar、场景、临时统计、节目状态和诊断属于本仓库。
- **实时观测不等于官方事实。** Broadcast 可以向 RivalHub 提交实时 projection 和赛果 candidate，但不直接写官方比赛表。
- **本地优先。** RivalHub 暂时不可达时，已经加载的 HUD / Radar / 场景仍应继续工作。
- **面向完整节目流程设计。** Gameplay HUD 只是其中一个 scene。
- **先建立可靠内核，再逐步打磨视觉。** 高级效果可以后置，但第一版架构不能把它们堵死。

## 当前确定的主要场景

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
TechnicalPause
Emergency
```

其中 BP/Veto 的官方数据来自 RivalHub；Broadcast 只负责把已经完成的 BP 作为节目时间线播放，不建立第二套实时 veto domain。

## 关键能力方向

- RivalHub Match / Roster / BP / Schedule / Branding 接入；
- CS2 GSI 接收、标准化和身份匹配；
- 高性能 Gameplay HUD；
- 可配置 Radar：选手编号/头像、自定义 marker、道具、烟火、轨迹、上下层；
- KDA、ADR、round history 等直播临时统计；
- 自动 scene suggestion + operator 手动控制；
- 中场、场间、赛后数据页面；
- wrong-match、断流、重连、离线 cache 与恢复；
- record/replay fixture、长时间 soak test；
- 向 RivalHub 提供低频 live projection 与结果 candidate；
- 为 server game events、C4 生存预测、OBS 控制、MulNX/HLAE、Replay、Camera 等高级能力保留 adapter/capability 接缝。

详细产品需求见 [`docs/product.md`](docs/product.md)。

## 仓库边界

```text
RivalHub
  官方赛事上下文 / lifecycle / canonical result
        │
        ▼
RivalHub Broadcast
  本地 telemetry / state / scenes / HUD / radar / diagnostics
        │
        ▼
OBS / Program

赛后：Demo → DAK → RivalHub evidence / confirmation
```

RivalHub 主仓的 Match Runtime 可能继续演进；本仓库只依赖稳定、版本化的 integration contract，不依赖其内部数据库结构、React 页面或实现细节。

## 初始目录规划

```text
apps/
  companion/            本地 runtime / composition root
  web/                  Operator / Program / Debug
packages/
  protocol/             版本化协议
  core/                 纯状态机、reducer、accumulator
  telemetry-gsi/        GSI adapter
  rivalhub/             RivalHub integration adapter
  radar/                Radar model / renderer hot path
  renderer-major/       RivalHub Major renderer
  testkit/              recorder / simulator / replay / chaos
docs/                   中文产品、架构与决策文档
fixtures/               可复现测试数据
```

目录边界目前是初始设计；具体 package API、transport、桌面壳和部署方式会通过 ADR 逐项确定。

## 文档

- [`docs/product.md`](docs/product.md)：当前产品需求基线，优先审阅。
- [`docs/architecture.md`](docs/architecture.md)：已确定的架构边界与待决事项。
- [`docs/references.md`](docs/references.md)：参考 HUD / 制播项目的取舍。
- [`docs/decisions/`](docs/decisions/)：Architecture Decision Records。
- [`AGENTS.md`](AGENTS.md)：面向开发 Agent 的仓库工作原则。

## 文档语言

仓库的一手文档默认使用中文。代码标识符、协议字段、第三方项目名与行业术语在更清晰时保留英文。

## License

RivalHub Broadcast 使用 **GNU Affero General Public License v3.0 (AGPL-3.0-only)**。

第三方依赖与参考项目的许可证边界单独记录在 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。
