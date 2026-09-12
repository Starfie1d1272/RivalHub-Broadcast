# 初始架构边界

> 状态：**Baseline**。本文记录已经足够明确、值得固定的架构边界。Runtime / Workspace 技术基线见 [ADR-0002](decisions/0002-runtime-workspace-technology-baseline.md)；RuntimeState、identity、delivery/backpressure 与跨仓 contract 边界见 [ADR-0003](decisions/0003-runtime-state-delivery-invariants.md)。

## 1. 架构目标

RivalHub Broadcast 是一套 local-first、event-driven、capability-aware 的 CS2 Broadcast Runtime。

架构优先级按顺序为：

1. 长时间直播不积压、不越来越延迟；
2. 官方赛事事实与本地观测严格分权；
3. Wrong Match / stale / reconnect / restart 能安全降级；
4. 可复现、可回放、可测试；
5. HUD / Radar / scene 能持续扩展；
6. 第三方能力通过 adapter/capability 接入，不污染 Core。

## 2. 四个 Plane

```text
Official Plane
  RivalHub Match / Roster / BP / Schedule / Result
                    │
                    ▼
Telemetry Plane
  GSI required
  server events / HLAE / observer tooling optional
                    │
                    ▼
Broadcast Core
  session / identity / runtime state / transitions / accumulators / scene policy
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
Presentation Plane        Uplink Plane
Program / Operator        ReliableObservation → #610
Debug / Radar / HUD       BroadcastLiveSnapshot → #615
```

## 3. 权威边界

### RivalHub

拥有长期官方事实：

- Match identity / lifecycle；
- CompetitionEntry；
- EventRoster / MatchRoster；
- canonical BP；
- schedule；
- official map/series result；
- Stage / Bracket progression；
- 对外 BroadcastManifest / ingest API 的服务端语义与校验。

### Broadcast

拥有本地运行态：

- telemetry ingress；
- normalized observation；
- live session / producer instance / map execution continuity；
- RuntimeState；
- HUD / Radar；
- scene / presentation control；
- provisional stats；
- local diagnostics / cache / replay；
- 发送给 RivalHub 的 observation / live snapshot producer payload。

### DAK / OCR

负责赛后 evidence 和更高质量统计，不作为低延迟 HUD 主循环依赖。

最重要的边界仍是：

> **Broadcast 产生 observation；RivalHub 决定 official truth。**

## 4. 初始 package ownership

```text
apps/companion
  本地 composition root。
  组装 HTTP、telemetry、RivalHub adapter、Core、local persistence、web output。

apps/web
  /operator /program /debug 的 UI。
  第一套 Major renderer 先作为 app 内 presentation module，不急于定义独立 renderer SDK。

packages/protocol
  Broadcast-owned local wire schema / DTO / fixture contract。
  主要服务 Companion ↔ Program / Operator / Debug；不得包含产品运行时状态机。

packages/core
  纯 TypeScript runtime/domain core：
  RuntimeState、session/identity、transitions、accumulators、scene policy、projectors。
  禁止依赖 React、HTTP server、WebSocket 实现、OBS、RivalHub DB 或具体 GSI library。

packages/telemetry-gsi
  Raw CS2 GSI → normalized telemetry。
  Raw GSI 类型不得泄漏出该 package。

packages/rivalhub
  BroadcastManifest consumer、pairing/auth、#610 ReliableObservation、#615 BroadcastLiveSnapshot uplink。
  只能通过主仓公开 versioned contract 工作，不直连 RivalHub/Supabase 表。

packages/radar
  Framework-neutral Radar domain：RadarFrame、world→radar、MapGeometryProvider、floor/marker/utility semantics、interpolation/autozoom math。
  React/SVG/Canvas/DOM renderer 与 rAF scheduling 属于 apps/web presentation。

packages/testkit
  recorder、replay、simulator、fault injection、fixtures。
```

仓库当前存在的 `packages/renderer-major` 只视为预留目录；在出现第二个真实 renderer consumer 或独立发布需求前，不把它当作必须维护的 library API boundary。

## 5. RuntimeState 与 Projection

Core 只有一份内部事实模型：

```text
Normalized Telemetry
+ RivalHub Context
+ Accumulators
+ Identity / Session
+ Presentation Control
        ↓
    RuntimeState
```

`RuntimeState` 不是 WebSocket payload。Consumer 通过 projector 获得自己的模型：

```text
RuntimeState
├─ ProgramModel
├─ RadarFrame
├─ OperatorModel
├─ DebugModel
├─ ReliableObservation
└─ BroadcastLiveSnapshot
```

禁止把一份巨型 `BroadcastState` 高频广播给所有 consumer。

## 6. Realtime delivery semantics

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
  wrong-match/stale/uplink/slow-consumer 等诊断状态
```

只有具备明确 consumer、可靠性和 retention 目的的消息才进入对应持久/重试机制；不建设通用 event-sourcing。

## 7. Session / identity / time invariant

至少区分：

```text
liveSessionId
  RivalHub Match ↔ producer session 绑定

producerInstanceId
  一次 Companion process/runtime 实例

mapEpoch
  一次地图 execution；正式 restart/restore 需要隔离旧 observation 时改变

seq
  明确 scope 内单调递增
```

不要用一个模糊 `epoch` 同时代表所有 restart/reconnect 情况。

Identity 至少表达：

```text
unbound
resolving
matched
degraded
mismatch
```

Capability 由 identity、telemetry 和 connection health 派生。`mismatch` 必须 fail closed：停止 RivalHub uplink，并禁止自信展示错误赛事品牌。

本地 timeout/staleness/interpolation 使用 monotonic clock；`observedAt` / `producedAt` / audit/log 使用 UTC wall clock。

## 8. Browser reconnect

Program / Operator / Debug 重连时：

```text
hello / protocol negotiation
→ current liveSessionId / mapEpoch
→ current baseline projection
→ continue live updates
```

不重放断线期间所有历史 snapshot。

## 9. Local-first 与 observation outbox

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

## 10. Scene 与 Overlay

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

临时视觉反馈使用 `OverlayCue`，例如：

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

自动逻辑不能覆盖 operator 的 manual scene；`suggestedScene` 应基于稳定后的 transition/state policy，而不是一次 partial GSI payload 直接跳场景。

## 11. Radar 边界

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

## 12. Capability 原则

高级能力必须声明真实可用性，例如：

```text
telemetry.gsi
telemetry.damage-source
radar.utility-timer
bomb.damage-prediction
observer.camera-control
obs.control
```

Renderer 只能在 capability 成立时展示需要该数据精度的效果。

## 13. RivalHub contract ownership 与术语

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

Broadcast 通过 `packages/rivalhub` 消费/生产这些公开 contract，可使用 machine-readable schema、generated/local validator 和 compatibility fixture，但不 import RivalHub 源码类型。

术语固定：

```text
BroadcastLiveSnapshot
  Broadcast → #615 producer payload

EphemeralLiveProjection
  #615 在 RivalHub 服务端维护的实时投影

PublicLiveMatchProjection
  公共 Match 页面消费的 read model
```

## 14. Local security baseline

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

## 15. Renderer 与浏览器边界

Renderer 消费 normalized projection，不消费 Raw GSI，不直接调用 RivalHub API。

React 负责 scene composition、结构布局与低频 UI；Radar marker、utility movement 等高频动画使用适合的 rAF/imperative hot path，避免把每个 GSI tick 等价为整棵 React rerender。

OBS Browser Source 的 CEF 版本不能假定与 Chrome Stable 同步。较新 Web API 必须 feature-detect/fallback；真实 OBS 是 `/program` 的生产验收环境。

## 16. Runtime / Workspace 技术基线

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
- Fastify、`ws`、React、具体 GSI parser 都属于 adapter/presentation，不得进入 `packages/core`。

## 17. 当前尚未冻结的事项

以下内容仍需要实现 spike 或后续 ADR：

- `BroadcastManifest` / ReliableObservation / BroadcastLiveSnapshot 精确字段；
- local HTTP/WS endpoint 与 message envelope；
- RivalHub pairing / credential storage；
- cloud live uplink rate；
- Radar asset 来源与生成流程；
- `MapGeometryProvider` contract 与 `@cs2dak/maps` 的具体消费方式；
- GSI parser dependency 的最终选择；
- Electron / Tauri / ordinary launcher / portable bundle 的 packaging 决策；
- Enhanced telemetry 与 server plugin 的范围；
- BombDamageProvider；
- OBS WebSocket；
- 第三方 HUD compatibility。

这些事项在有足够证据前不得因为“参考项目这样做”而自动成为仓库约定。