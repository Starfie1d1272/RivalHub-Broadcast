# 初始架构边界

> 状态：**Baseline**。本文记录已经足够明确、值得固定的架构边界。Runtime / Workspace 技术基线见 [ADR-0002](decisions/0002-runtime-workspace-technology-baseline.md)；RuntimeState、identity、delivery/backpressure 与跨仓 contract 边界见 [ADR-0003](decisions/0003-runtime-state-delivery-invariants.md)；Program / Observer Assist 隔离见 [ADR-0004](decisions/0004-program-output-and-observer-assist-isolation.md)；产品能力线、RivalHub 第一方集成与可移植性边界见 [ADR-0005](decisions/0005-product-capability-boundaries-and-portability.md)。

## 1. 架构目标

RivalHub Broadcast 是一套 local-first、**snapshot + explicit-transition driven**、capability-aware 的 CS2 Broadcast Runtime。产品上以 RivalHub 为第一方赛事集成，但架构上把 RivalHub-specific 语义限制在 adapter / contract boundary，不把主站内部类型或在线服务变成 Shared Runtime Foundation、Radar 或 Lookahead 的隐式运行前提。

这里刻意不把系统概括成“所有东西都是 Event”。高频可覆盖状态以 current snapshot 为主；只有 round/map/session 等真正的边沿变化才形成明确 `RuntimeTransition`。这与后文“不要建设万能 EventJournal/event-sourcing”保持一致。

架构优先级按顺序为：

1. 长时间直播不积压、不越来越延迟；
2. 官方赛事事实与本地观测严格分权；
3. Program 与 Observer Assist future information 不发生误播/泄漏；
4. Wrong Match / roster mismatch / stale / reconnect / restart 能安全降级；
5. 可复现、可回放、可测试；
6. HUD / Radar / scene / Assist 能持续扩展；
7. 第三方能力通过 adapter/capability 接入，不污染 Core；
8. RivalHub-first 的产品深度与 Core / Radar / Lookahead 的可移植性同时成立，不通过过早通用化换取“可移植”。

### 1.1 产品能力与架构分层

顶层产品结构不是三个彼此独立的系统，而是一套 Shared Runtime Foundation 上的三条 consumer capability line：

```text
Integration / Source adapters
  RivalHub / Program GSI / Lookahead CSTV / future enhanced telemetry
                           │
                           ▼
Shared Runtime Foundation
  normalization / continuity / identity / RuntimeState / replay / delivery
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
赛事与实时数据          正式节目制播       Observer Assist / Lookahead
Tournament &           Program            private future cue
Live Data              Production
```

三条能力线分别拥有不同的输出和 authority：

- **赛事与实时数据**：把 canonical tournament context 与 realtime observation 连接起来，向 RivalHub 产生 ReliableObservation / BroadcastLiveSnapshot 等版本化输出；
- **正式节目制播**：从 Program-safe runtime slice 构造 HUD / Radar / scenes / OBS Program；
- **Observer Assist / Lookahead**：从 Assist-private evidence + Program-safe timing/context 构造本机 future cue。

Shared Runtime Foundation 拥有 continuity / identity / RuntimeState / transitions / health / capability / capture/replay / bounded delivery 等公共语义。产品能力线不能各自复制一套 session、map epoch 或 identity truth。

RivalHub 是当前默认且最完整的赛事 context provider，但依赖方向固定为 `adapter → Broadcast-owned domain → consumer projection`。如果未来出现第二个 provider、独立 Assist 发行或其它赛事 context source，应优先新增 adapter，而不是改写 Core ownership。

当前不因此拆仓库、不建设通用电竞协议或 plugin framework；物理拆分必须由第二个真实 consumer/provider 或独立发行需求证明。

## 2. 四个 Plane

```text
Official Plane
  RivalHub Match / Roster / BP / Schedule / Result
                    │
                    ▼
Telemetry Plane
  Delayed Program GSI required
  no-delay Lookahead / server events / HLAE optional
                    │
                    ▼
Broadcast Core
  session / identity / runtime state / transitions / accumulators / scene policy
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
Presentation Plane         Uplink Plane
Program / Operator         ReliableObservation → #610
Observer Assist / Debug    BroadcastLiveSnapshot → #615
Radar / HUD / scenes
```

这四个 Plane 描述 authority / data-flow，不与上一节三条产品能力线一一对应：赛事与实时数据主要跨 Official / Core / Uplink，正式节目制播主要跨 Telemetry / Core / Presentation，Observer Assist 则在独立 Lookahead input 与 Assist-private presentation 之间工作。

Delayed Program feed 与 no-delay Lookahead feed **不是两个对等 Program source**。Lookahead 只拥有 advisory 资格，不拥有 Program fallback 资格。

## 3. 权威边界

### RivalHub

拥有长期官方事实：

- Match identity / lifecycle；
- CompetitionEntry；
- EventRoster / MatchRoster；
- canonical BP；
- schedule / `scheduledAt` / canonical `startedAt`；
- coverage / commentator assignment；
- official map/series result；
- Stage / Bracket progression；
- 对外 BroadcastManifest / ingest API 的服务端语义与校验。

RivalHub #610 的 canonical lifecycle 不依赖 Broadcast/GSI。完整 BP、可信 Broadcast observation、人工赛务等路径最终由 #610 汇入同一 canonical command/service。

### Broadcast

拥有本地运行态：

- telemetry ingress；
- normalized observation；
- live session / producer instance / map execution continuity；
- RuntimeState；
- Program / Observer Assist / Operator / Debug projection；
- HUD / Radar；
- scene / presentation control；
- provisional stats；
- lookahead alignment / Assist cue；
- local diagnostics / cache / replay；
- 发送给 RivalHub 的 observation / live snapshot producer payload。

### DAK / OCR

负责赛后 evidence 和更高质量统计，不作为低延迟 HUD 主循环依赖。

最重要的边界仍是：

> **Broadcast 产生 observation；RivalHub 决定 official truth。**

同时：

> **no-delay Lookahead information 可以帮助人提前切镜，但不能反向成为 Program 或公共 live state。**

## 4. Package ownership

```text
apps/companion
  本地 composition root。
  组装 HTTP、telemetry、RivalHub adapter、Core、production capture、local persistence、web output、OBS integration。

apps/web
  /operator /program /debug 的 UI。
  Observer Assist 可作为独立 route 或 desktop/topmost overlay surface 接入，但业务上不是独立用户角色。
  第一套 Major renderer 先作为 app 内 presentation module，不急于定义独立 renderer SDK。

packages/protocol
  Broadcast-owned local wire schema / DTO / fixture contract。
  主要服务 Companion ↔ Program / Observer Assist / Operator / Debug；不得包含产品运行时状态机。

packages/core
  纯 TypeScript runtime/domain core：
  RuntimeState、session/identity、transitions、accumulators、scene policy、projectors、Assist policy 所需纯逻辑。
  禁止依赖 React、HTTP server、WebSocket 实现、OBS、RivalHub API/client/内部类型或具体 GSI/CSTV parser。

packages/telemetry-gsi
  Raw CS2 GSI → normalized telemetry。
  Raw GSI 类型不得泄漏出该 package。
  source-specific block semantics 以 docs/telemetry.md 为准。

packages/telemetry-cstv
  Live CSTV `/sync` → `/start` → `/full` → `/delta` adapter。
  这是唯一允许直接接触 `cs2parser` 的 package；只向 Core 输出 parser-neutral `GameEventObservation`。
  Program 与 Lookahead 使用独立 source role、generation、sequence 与健康语义，不把 Lookahead 作为 Program fallback。
  `cs2parser` 的第三方类型与 raw event object 不得越过本 package 的 binding/normalizer。

packages/rivalhub
  RivalHub 第一方 adapter：BroadcastManifest consumer、pairing/auth、#610 ReliableObservation、#615 BroadcastLiveSnapshot uplink。
  只能通过主仓公开 versioned contract 工作，不直连 RivalHub/Supabase 表；不得反向拥有 Core / Radar / Lookahead domain contract。

packages/radar
  Framework-neutral Radar domain：RadarFrame、world→radar、MapGeometryProvider、floor/marker/utility semantics、interpolation/autozoom math。
  React/SVG/Canvas/DOM renderer 与 rAF scheduling 属于 apps/web presentation。
  可以消费 Broadcast-owned identity/display enrichment，但不能把 RivalHub package shape 变成 Radar contract。

packages/testkit
  capture reader、replay、simulator、fault injection、fixtures、deterministic assertions。
```

production recorder 属于 Companion/telemetry runtime，不属于 `packages/testkit`，也不得让 production runtime 反向依赖 testkit。

第一套 Major renderer 留在 `apps/web` presentation 内；在出现第二个真实 renderer consumer 或独立发布需求前，不建立独立 renderer package/API boundary。

同理，当前 Lookahead 继续作为同一 monorepo 内的能力线和 adapter/runtime seam 演进；在出现第二个真实 provider/独立发行需求前，不建立独立仓库或通用 plugin SDK。

## 5. RuntimeState、Projection 与 ReliableObservation

Core 只有一份内部 runtime aggregate，但“一份 RuntimeState”不等于一个无边界、所有 consumer 都能直接读取的万能对象。

概念上至少区分：

```text
RuntimeState
├─ official / match context
├─ program-safe runtime slice
│  ├─ normalized Program telemetry
│  ├─ accumulators / identity / session
│  └─ Program presentation control
├─ assist-private runtime slice
│  ├─ bounded Lookahead evidence
│  ├─ timeline alignment health
│  └─ current/scheduled Assist cue
└─ operational health / incidents
```

Core 仍只有一份 domain truth；这些是同一 runtime aggregate 内的结构化 ownership，而不是 `ProgramState` / `CasterState` 等互相竞争的第二套 truth。

当前状态类 consumer 通过 projector 获得自己的模型：

```text
RuntimeState
├─ ProgramProjection
├─ RadarFrame
├─ ObserverAssistProjection
├─ OperatorProjection
├─ DebugProjection
└─ BroadcastLiveSnapshot
```

### Program / Assist 是硬边界

```text
ProgramProjection
  允许进入正式节目 / OBS / 观众视野的信息
  只从 program-safe input 构造

ObserverAssistProjection
  只包含本机解说兼 OB 需要的辅助 cue
  可以消费 program-safe timing/context + assist-private input
  不作为 ProgramProjection 的超集

OperatorProjection
  match/config/health/scene/incident/recovery/uplink/OBS/alignment

DebugProjection
  raw/normalized diagnostics / timing / evidence
```

Future fields 不得先进入 ProgramProjection 再靠 CSS、route、窗口层级或 OBS visibility 隐藏。Program projector / #615 producer 应尽量通过 narrowed typed input / selector / schema boundary 实现 **safety by construction**，而不是依赖“拿到万能 state 后记得别读某字段”。

`ReliableObservation` 属于边沿消息，不等价于 current-state projection：

```text
RuntimeTransition
+ transition-time RuntimeState / context
        ↓
ReliableObservation candidate
        ↓
validation / idempotency / outbox
```

因此：

- 禁止把一份巨型 RuntimeState 高频广播给所有 consumer；
- projection 不成为第二份 domain truth；
- ReliableObservation 必须携带/保留触发 transition 时必要的 evidence/context，不能在事后只从新的 current RuntimeState 猜已经发生的边沿事实。

## 6. Program feed 与 Lookahead feed

当前业务语义：

```text
Delayed Program feed
  → CS2 observer / GSI
  → Program HUD / Radar / scenes
  → OBS
  → #615 BroadcastLiveSnapshot

No-delay Lookahead feed
  → machine-only headless parser
  → event/tick evidence
  → timeline alignment
  → ObserverAssistProjection
```

约束：

- Lookahead feed 没有 Program eligibility；
- Program down 不触发 Lookahead→Program fallback；
- Lookahead down 时 Program 正常继续，只关闭/降级 Assist；
- Perfect `...5 / ...6` 和约 120 秒只是 provider discovery/configuration fact，不进入 Core invariant；
- wrong-match / map mismatch / alignment unhealthy 时 Assist fail closed；
- map change / reconnect 后必须重新建立可信 alignment 才恢复 future cue。

两条 ingress 具有独立连接连续性。Program GSI reconnect 和 Lookahead parser reconnect 不应被一个全局 sequence/epoch 模糊掉。每个 source 至少要在 adapter/alignment 层表达：

```text
sourceRole
sourceInstance / sourceGeneration
source-local seq / tick / observedAt
sourceHealth
```

source generation 变化时，依赖该 source 的旧 alignment 立即失效；重新证明 same match / map / tick relation 后才能恢复 cue。

Lookahead 核心 contract 应保持 Broadcast-owned：source acquisition 可以 provider-specific，但 timeline identity/alignment、future-event evidence 与 cue scheduling 不能以 RivalHub Web/domain implementation 作为算法前提。RivalHub 可提供 canonical roster、display、branding、lifecycle 等 enrichment 和 identity evidence。

### 第一阶段 Assist

基础完成条件只需要：

```text
player_death observed on Lookahead
+ attacker / victim / event tick
+ current Program tick
→ target lead-time scheduling
→ countdown + killer→victim + optional reliable location
```

不要求 engagement/story 分类、AI ranking、prediction 或自动切镜。

RFC-0001 可以继续研究更丰富的 cue/transport/relay 方案，但不改变上述基础 invariant。

## 7. Realtime delivery semantics

### Snapshot lane

```text
latest-wins
bounded
droppable
```

适合 HP、money、position、clock、bomb position 等高频可覆盖状态。

每个 consumer 最多保留：

```text
正在发送的 snapshot
+ 最新一个 pending snapshot
```

例如：

```text
sending 101
102 arrives → pending = 102
103 arrives → pending = 103
101 sent    → send 103
```

不得形成 `101 → 102 → 103 → ...` 的旧状态 FIFO。

### Reliable semantics

“Event”不作为万能桶，至少区分：

```text
RuntimeTransition
  round/map/bomb/session boundary

OperatorCommand
  人对 presentation/runtime 的显式操作

ReliableObservation
  发往 RivalHub #610 的低频、高价值 observation

Incident
  wrong-match/roster-mismatch/stale/uplink/slow-consumer/alignment 等诊断状态
```

只有具备明确 consumer、可靠性和 retention 目的的消息才进入对应持久/重试机制；不建设通用 EventJournal/event-sourcing。

## 8. #610 lifecycle、ObservationHealth 与 identity

Broadcast/GSI 是可选 observation source；没有 telemetry 的比赛仍由 RivalHub #610 正常通过 BP + 人工逐图完成。

Broadcast 的职责是产生可信 observation candidate，而不是拥有 Match lifecycle。

### Start evidence

```text
canonical BP 完整保存
→ #610 正常 start evidence

trusted Broadcast 观察到 gameplay
→ match_started ReliableObservation
→ #610 可以承认现实 in_progress
```

如果 GSI 已开始但 BP 漏填，Broadcast 在 Operator/Admin 侧产生内部 warning；Program 不泄漏后台赛务错误。

### Steam64 自动核验

```text
canonical MatchRoster / active lineup Steam64
↕
observed players
```

Identity 至少表达：

```text
unbound
resolving
matched
degraded
mismatch
```

Capability 由 identity、telemetry health 与 canonical context 派生。

`mismatch` 的 fail-closed 精确含义：

- 停止错误 Match 的 public snapshot / branding uplink；
- 停止自动 result canonicalization eligibility；
- 保留已经发生的 observation/evidence 供 #610 reconciliation；
- 如果现实比赛已经可信开始，不因为 preparation/roster incident 否认 in_progress。

`MatchPreparation` 与 `ObservationHealth` 是不同 projection，不压成一个 `canStart` boolean。

当前 no-delay Lookahead feed 的业务 owner 是 Observer Assist。是否未来让它参与 #610 更早 observation 必须通过独立 contract 决定，不自动扩张。

## 9. Session / identity / time invariant

至少区分：

```text
liveSessionId
  RivalHub Match ↔ producer session 绑定

producerInstanceId
  一次 Companion process/runtime 实例

mapEpoch
  一次地图 execution；正式 restart/restore 需要隔离旧 observation 时改变

runtime/uplink seq
  在明确 producer / protocol scope 内单调递增
```

不要用一个模糊 `epoch` 同时代表所有 restart/reconnect 情况，也不要让 runtime/uplink `seq` 兼任某个 telemetry ingress 的 source-local sequence。

Program / Lookahead 各自的 connection generation、source-local seq/tick 属于对应 adapter/alignment continuity。单纯 Lookahead parser reconnect 不应推进 Program `mapEpoch`；真正的 map execution restart 才改变 map-level continuity。

本地 timeout/staleness/interpolation 使用 monotonic clock；`observedAt` / `producedAt` / audit/log 使用 UTC wall clock。

## 10. Browser reconnect

Program / Operator / Debug 重连时：

```text
hello / protocol negotiation
→ current liveSessionId / mapEpoch
→ current baseline projection
→ continue live updates
```

不重放断线期间所有历史 snapshot。

Observer Assist 如果是 browser/desktop consumer，同样获取当前 alignment health + 当前 cue baseline 后继续，不重放已经过期的 future cue。

## 11. Local-first 与 observation outbox

RivalHub 暂时不可达不能让已运行的 Program 立即失效。本地需要 last-known-good match context、必要节目资产和 compact recovery state。

必须区分：

```text
canonical / high-impact command
  离线时不自动排队恢复后执行

ReliableObservation
  允许进入 bounded durable outbox
  reconnect 后重新验证 session/epoch/revision/identity 再安全 retry
```

Outbox 必须有 idempotency、bounded retention、retry/backoff、stale invalidation 与 Operator/Debug 可见性。

## 12. Scene 与 Overlay

基础节目状态使用 `BaseScene`：

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

临时节目反馈使用 `OverlayCue`，例如：

```text
Clutch
Ace
MultiKill
DamageFeedback
BombUrgency
Timeout
TechnicalWarning
```

`TechnicalPause` 可以按节目需要成为 Gameplay overlay 或独立完整画面，不在 Core enum 中提前锁死唯一视觉实现。

Scene policy 维护：

```text
suggestedScene
activeScene
mode = auto | manual
```

自动逻辑不能覆盖 operator 的 manual scene；`suggestedScene` 应基于稳定后的 transition/state policy，而不是一次 GSI frame 直接跳场景。

Observer Assist cue 不等价于 Program OverlayCue；future kill cue 不进入 Program scene graph。

## 13. Radar 边界

`packages/radar` 拥有：

```text
RadarFrame / projection
world → radar transform
MapGeometryProvider
floor selection
marker / utility semantics
interpolation / autozoom math
```

`apps/web` presentation 拥有：

```text
React / SVG / Canvas / DOM renderer
CSS/theme
requestAnimationFrame scheduling
OBS/browser-specific rendering
```

当前默认 `MapGeometryProvider` 计划复用 DAK `@cs2dak/maps` 的 calibration，但 Radar 不直接把 DAK package shape 当成自己的 domain contract。

Radar source snapshot 频率与浏览器渲染频率分离，使用 interpolation/presentation scheduling 平滑，而不是无界提高 transport 频率。

## 14. Capability 原则

高级能力必须声明真实可用性，例如：

```text
telemetry.gsi
telemetry.lookahead
telemetry.damage-source
observer.assist
radar.utility-timer
bomb.damage-prediction
observer.camera-control
obs.control
```

Renderer/Projector 只能在 capability 成立时展示需要该数据精度的效果。

Capability 也用于可移植性降级：缺少 RivalHub avatar/branding 等 enrichment 时，可以降低 display capability；但不能把 display enrichment 缺失误判为 Program timeline、Lookahead alignment 或 Runtime continuity 失效。反之，identity 无法可靠绑定到目标 Match 时仍必须按安全边界 fail closed。

## 15. RivalHub contract ownership 与术语

Broadcast-owned local contract：

```text
Companion ↔ Program
Companion ↔ Observer Assist
Companion ↔ Operator
Companion ↔ Debug
```

RivalHub-owned API boundary：

```text
BroadcastManifest
#610 Reliable Observation ingest
#615 Live Snapshot ingest
```

Broadcast 通过 `packages/rivalhub` 消费/生产这些公开 contract，可使用 machine-readable schema、generated/local validator 和 compatibility fixture，但不 import RivalHub 源码类型。

`BroadcastManifest` 的 consumer 需求至少包括：

```text
schemaVersion / revision / updatedAt
season / stage / match identity
format / scheduledAt / startedAt / canonical status
CompetitionEntry display / logo
MatchRoster / Steam64 / player display / avatar
map pool / canonical BP
canonical map / result state
coverage / commentator / stream context
branding / sponsor metadata
```

只下发制播 whitelist facts，不携带 email、教育材料、内部审核记录等无关 PII。

读路径与写路径分阶段，但不等到 uplink 阶段才第一次验证真实赛事上下文：

```text
M2
  冻结 BroadcastManifest consumer schema / validator / same-shape fixture

M3
  用真实 read-only Manifest + last-known-good cache 跑完整 Program workflow

M4
  pairing/auth hardening
  ReliableObservation / BroadcastLiveSnapshot write path
  outbox / security / re-auth
```

这样可以在 scene/HUD/Radar 仍可调整时尽早暴露真实 Match/Roster/BP/Branding contract 问题，同时把高风险写路径留到本地 runtime 稳定以后。

术语固定：

```text
BroadcastLiveSnapshot
  Broadcast → #615 producer payload
  只来自 Delayed Program timeline

EphemeralLiveProjection
  #615 在 RivalHub 服务端维护的实时投影

PublicLiveMatchProjection
  公共 Match 页面消费的 read model
```

no-delay Lookahead future state 不进入 `BroadcastLiveSnapshot`。

公开 Match 页面、SSE/WebSocket/Realtime/REST 或未来其它数据分发属于 RivalHub / 对应云端服务 owner；Broadcast Companion 只拥有安全、标准化的 producer contract，不直接承担公网 data-provider 职责。

## 16. Local security baseline

默认：

```text
bind = 127.0.0.1
LAN = explicit opt-in
```

并保持：

```text
GSI token
!= local operator credential
!= RivalHub producer credential
```

进入 pairing/LAN/uplink 前必须补齐 Origin/session/protocol validation、scoped credential、log/fixture redaction 等安全措施。不得为了局域网访问直接无保护暴露 `0.0.0.0`。

Lookahead CSTV/playcast URL、token 等可能属于赛事凭据，不能进入公开 fixture/log。

## 17. Renderer、浏览器与 OBS 边界

Renderer 消费 consumer-specific normalized projection，不消费 Raw GSI，不直接调用 RivalHub API。

React 负责 scene composition、结构布局与低频 UI；Radar marker、utility movement 等高频动画使用适合的 rAF/imperative hot path，避免把每个 GSI tick 等价为整棵 React rerender。

OBS Browser Source 的 CEF 版本不能假定与 Chrome Stable 同步。较新 Web API 必须 feature-detect/fallback；真实 OBS 是 `/program` 的生产验收环境。

官方 OBS Program preset 是 production integration：

```text
RivalHub Program Scene
├─ CS2 Program Capture（Delayed GOTV）
├─ /program Browser Source
└─ Program-safe assets
```

不得包含 Observer Assist surface/window。

`obs-websocket` 或等价 control channel 可以负责 preset 创建/校验/修复和未来可选 scene control，但控制通道断开后现有 `/program` Browser Source 必须继续工作。深度 auto-director / 复杂 orchestration 继续后置。

如果 Observer Assist 采用透明 topmost/click-through window，必须通过真实 Windows + OBS rehearsal 验证官方 capture path 不会把它录入 Program。

## 18. Runtime / Workspace 技术基线

详见 [ADR-0002](decisions/0002-runtime-workspace-technology-baseline.md)。当前选择：

```text
Runtime           Node.js 24.x LTS
Language          TypeScript 7 / ESM-only
Workspace         pnpm 12 native workspace + catalog
Web               React 19 stable line + Vite 8
Local HTTP        Fastify 5
Local WebSocket   ws 8
Wire validation   Zod 4
Tests             Vitest 5 + Playwright 1.63 + testkit replay
```

版本原则：

- 初始化与常规升级优先 stable release；
- `package.json` / lockfile 固定实际精确版本；
- 同一已选技术路线内的兼容 patch/minor 升级通过正常 dependency PR + replay/build/visual checks，不需要新 ADR；
- runtime major、framework major 或带来架构语义变化的升级才需要重新决策；
- Node production line 优先 LTS，并以真实 Windows/OBS soak 作为升级 gate。

补充 invariant：

- Shared package 默认构建为普通 ESM JS + `.d.ts`，不直接导出 `src/*.ts`；
- Shared library 默认不 bundle；Web production output 由 Vite/Rolldown bundle；
- Node package 使用 `nodenext` module resolution，Web 使用 bundler resolution；
- production 不依赖 Node type stripping 直接执行完整 TypeScript 应用；
- 初版不引入 Turborepo/Nx；只有真实 CI profiling 证明需要时再增加；
- Fastify、`ws`、React、具体 GSI/CSTV parser、OBS client 都属于 adapter/presentation，不得进入 `packages/core`。

## 19. 可执行依赖护栏

仓库提供 `pnpm architecture:check`，把本文件和 ADR 中已经稳定的 negative invariant 转成可执行契约。它负责检查 shared package 的 `dist`/ESM/declaration exports、workspace `workspace:` protocol、显式 workspace dependency、runtime dependency cycle、TypeScript `paths`，以及 Core、Protocol、Radar、Web、RivalHub 的高置信度 forbidden ownership boundary。

`scripts/architecture/policy.mjs` 是 checker 与 ESLint direct-import fast feedback 共享的机器规则来源；checker 还会解析 static import、re-export、dynamic import、`require` 与 type-only edge。该 guard 不冻结完整 positive dependency matrix，也不替代后续真实 runtime/protocol ADR。发现冲突时应先修正真实 owner 或更新决策，不通过 baseline、known-violation 或 wildcard ignore 压制结果。

Program/Assist isolation 的语义优先通过 contract/fixture/projector tests 与真实 OBS acceptance；只有出现高置信静态依赖规则时再加入 architecture checker，避免用依赖图伪装运行时数据隔离测试。

ADR-0005 增加的“RivalHub-first 但不反向锁定 Core/Radar/Lookahead”原则同样优先落实为清晰 package ownership、contract tests 和真实 standalone/local fixture；只有高置信 forbidden dependency 出现时才把对应规则加入 architecture checker，不提前冻结完整插件式依赖矩阵。

## 20. 当前尚未冻结的事项

以下内容仍需要实现 spike 或后续 ADR：

- `BroadcastManifest` / ReliableObservation / BroadcastLiveSnapshot 精确字段；
- local HTTP/WS endpoint 与 message envelope；
- RivalHub pairing / credential storage；
- cloud live uplink rate；
- Radar asset 来源与生成流程；
- `MapGeometryProvider` contract 与 `@cs2dak/maps` 的具体消费方式；
- GSI parser dependency 的最终选择；
- Lookahead CSTV headless parser / alignment implementation 的最终选择；
- Observer Assist 是 browser route、透明 desktop window 还是其它 shell integration；
- Electron / Tauri / ordinary launcher / portable bundle 的 packaging 决策；
- Enhanced telemetry 与 server plugin 的范围；
- BombDamageProvider；
- OBS 深度 scene orchestration / auto-director；
- 第三方 HUD compatibility；
- 是否以及何时出现独立 Lookahead/数据产品 packaging；
- 第二个 tournament context provider / CSTV provider 的具体 adapter。

以下内容已经不再属于“是否要做”的开放问题：

- 当前真实现场角色是单人解说兼 OB；
- RivalHub 是第一方 canonical tournament integration，但 Shared Runtime / Radar / Lookahead 不 import RivalHub 内部实现；
- 产品按“赛事与实时数据 / 正式节目制播 / Observer Assist”三条能力线组织，共享一套 Runtime Foundation；
- Delayed Program feed 是唯一 Program timeline；
- no-delay Lookahead feed 是 machine-only Assist input，不具备 Program fallback eligibility；
- Observer Assist future information 与 Program/#615/OBS 必须硬隔离；
- 第一阶段 Assist 以确定性 future kill cue 为目标，不要求 engagement/AI/auto TAKE；
- 官方 OBS Program preset 不包含 Observer Assist，并需要一键配置/校验能力；
- 当前不因未来可移植/商业化可能性拆仓库、建设通用电竞协议或 plugin framework。

这些事项在有足够证据前不得因为“参考项目这样做”而自动成为仓库约定。
