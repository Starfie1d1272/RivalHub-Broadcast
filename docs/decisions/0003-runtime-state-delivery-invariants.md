# ADR-0003：Runtime State、Identity 与 Delivery Invariants

- 状态：**Accepted**
- 日期：2026-09-12
- 关联：ADR-0001、ADR-0002、`docs/product.md`、`docs/architecture.md`、RivalHub #610 / #615
- Supersedes：ADR-0002「决策 6」中“`packages/protocol` 是跨仓 integration contract owner”的过宽表述；ADR-0002 其余技术基线继续有效。

## 背景

ADR-0002 已冻结 Runtime / Workspace 技术栈，但在正式实现 Core 前，还需要把实时系统最容易走偏的语义边界固定下来：

- 单一 `BroadcastState` 不能同时成为 domain state、WebSocket payload、Radar frame、公开网站 snapshot；
- “Event” 不能成为 round transition、operator command、RivalHub uplink、diagnostic incident 的万能桶；
- reconnect、restart、wrong match、map restart 必须有明确的 session / epoch / sequence 语义；
- latest-wins 必须落实为真实 backpressure 行为，而不是只写在文档里；
- 离线期间不能自动执行危险 canonical command，但可靠 observation 也不能因为短暂断网永久丢失；
- RivalHub 与 Broadcast 必须通过公开 versioned contract 集成，但各自拥有不同的 contract surface。

本 ADR 固定这些 **runtime invariants**。具体 schema 字段、HTTP path、WebSocket message name、持久化实现仍由后续实现/ADR 决定。

---

## 1. Core 只有一份 RuntimeState，consumer 使用 projection

Broadcast Core 维护一份内部事实模型：

```text
Normalized Telemetry
+ RivalHub Context
+ Accumulators
+ Identity / Session
+ Presentation Control
        ↓
    RuntimeState
```

`RuntimeState` **不是 wire DTO**，不得直接整份广播给所有 consumer。

Consumer 通过纯 projector / selector 得到自己的模型：

```text
RuntimeState
├─ ProgramModel
├─ RadarFrame
├─ OperatorModel
├─ DebugModel
├─ ReliableObservation
└─ BroadcastLiveSnapshot
```

规则：

- 所有 projection 都可由当前 RuntimeState 与明确的 transient input 重建；
- projection 不反向成为第二份 domain truth；
- Radar 高频变化不能迫使 BP、branding、diagnostics 等无关字段一起传输；
- renderer 不消费 Raw GSI，也不读取 RivalHub API；
- cloud snapshot 不等于本地 Program model。

---

## 2. Snapshot 与可靠消息继续分 lane，但“Event”必须细分语义

### Snapshot

适用于 position、HP、money、clock、bomb position 等可被更新状态覆盖的数据：

```text
latest-wins
bounded
droppable
```

旧 snapshot 没有“补播价值”。

### RuntimeTransition

表示本地 runtime 观察到的边界变化，例如：

```text
round_started
round_ended
map_started
map_ended
bomb_planted
side_changed
map_restart_detected
```

主要服务 accumulator、scene suggestion、diagnostics。要求 epoch-scoped、可去重；不自动等于 RivalHub canonical mutation。

### OperatorCommand

表示人对 presentation/runtime 的显式操作，例如：

```text
scene override
BP playback next/previous
manual presentation reset
```

必须有 command/request identity 与 ack/error；OperatorCommand 不是 telemetry event。

### ReliableObservation

表示 Broadcast 准备提交给 RivalHub #610 的低频、高价值观察，例如：

```text
match_started observation
map_ended observation
series_ended observation
identity / continuity warning
result candidate
```

必须具备足够的 session / epoch / sequence / observedAt / identity / quality 上下文，并满足 retry/idempotency 要求。

### Incident

表示本地系统异常或降级状态，例如：

```text
wrong_match
stale_manifest
telemetry_stale
sequence_gap
uplink_unavailable
renderer_slow_consumer
```

Incident 用于 Operator / Debug / logging / health；不能因为“也是事件”就自动进入可靠业务 uplink。

**禁止建设一个无差别、永久保存所有东西的万能 EventJournal / event-sourcing 模型。** 需要持久化的 lane 必须有明确 consumer 与 retention 目的。

---

## 3. Session / Instance / Map execution 必须分层

至少区分：

```text
liveSessionId
  RivalHub Match ↔ 一个被服务端认可的 Broadcast producer session 绑定

producerInstanceId
  一次 Companion process/runtime 实例；进程重启后改变

mapEpoch
  当前一张地图的一次实际 execution；正式 map restart / restore 导致旧 observation 不能继续污染新 execution 时改变

seq
  在明确 scope 内单调递增，用于 stale / duplicate / reorder 检测
```

不要用一个模糊的 `epoch++` 同时代表进程重启、网络 reconnect、地图 restart、切换 Match。

具体是否还需要额外 `runtimeEpoch`，只有在实现证明上述层级仍不足时再增加。

---

## 4. Identity 是状态机，不是 boolean

推荐最小状态：

```text
unbound
→ resolving
→ matched
→ degraded
→ mismatch
```

语义：

- `unbound`：尚未绑定 RivalHub Match；
- `resolving`：已有目标 Match，但 telemetry identity 尚未完成验证；
- `matched`：队伍 / roster / map / session 等关键 invariant 满足；
- `degraded`：可继续部分本地 presentation，但存在缺失/低置信映射；
- `mismatch`：明确 Wrong Match / stale session / 冲突 identity。

Capability 由 identity + telemetry + connection health 派生，而不是由 UI 猜测。例如：

```text
presentation.branding
uplink.liveSnapshot
uplink.reliableObservation
resultCandidate.autoEligible
radar.utility
```

`mismatch` 时必须 fail closed：关闭 RivalHub uplink 与错误品牌；Program 可降级为中性 CT/T presentation，而不是自信展示错误队伍。

---

## 5. Duration 使用 monotonic clock；跨机器事实使用 wall clock

本地 duration / timeout / staleness / interpolation 使用单调时钟：

```text
performance.now()
process.hrtime.bigint()
```

不得用 wall-clock delta 作为本地 timeout 的唯一依据，因为 NTP、系统时间调整、休眠恢复会产生跳变。

跨机器 protocol / audit 使用 UTC wall-clock timestamp，例如：

```text
observedAt
producedAt
receivedAt
loggedAt
```

因此：

```text
monotonic clock → “过了多久”
wall clock      → “什么时候发生”
```

---

## 6. Latest-wins 必须是可测试的 backpressure contract

每个 snapshot consumer 都必须有**常数级有界 pending state**，不能形成旧 snapshot FIFO。

目标行为：

```text
sending snapshot 101
102 arrives → pendingLatest = 102
103 arrives → pendingLatest = 103
101 sent    → send 103
```

而不是：

```text
101 → 102 → 103 → ...
```

实现可以参考 transport 的 `bufferedAmount` / drain signal / explicit single-flight state，但语义必须保持：

- 每个 consumer 最多保留“正在发送 + 最新待发”；
- 慢 consumer 不阻塞其他 consumer；
- queue/memory 不随运行时长增长；
- slow-consumer 行为必须进入 replay/soak test。

### Browser reconnect

Program / Operator / Debug reconnect 时：

```text
hello / protocol negotiation
→ current session / epoch
→ current baseline projection
→ continue live updates
```

不重放断线期间所有历史 snapshot。

---

## 7. 离线 replay：Canonical command 与 ReliableObservation 必须区别对待

### Canonical / high-impact command

离线时不得静默排队并在恢复网络后自动执行，例如未来可能存在的 adjudication / recovery 类操作。

### ReliableObservation

短暂断网不能让 `map_ended` 等可靠 observation 永久丢失。

允许使用**有界、持久的 observation outbox**，但重连后发送前必须重新验证：

```text
liveSessionId
mapEpoch
manifest revision / relevant canonical context
identity state
credential scope
```

只有 observation 仍然属于当前可信 session/context 时才允许 retry。它提交的是“我观察到了什么”，不是离线替 RivalHub 执行 canonical mutation。

Outbox 必须有：

- bounded retention；
- idempotency key；
- retry/backoff；
- accepted / rejected / superseded 状态；
- stale session/epoch 自动失效；
- Operator/Debug 可见性。

---

## 8. Scene 分为 BaseScene 与 OverlayCue

基础节目状态：

```text
BaseScene
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

临时反馈不继续膨胀 scene enum，而使用：

```text
OverlayCue
Clutch
Ace
MultiKill
DamageFeedback
BombUrgency
Timeout
TechnicalWarning
...
```

`TechnicalPause` 可以根据实际节目设计实现为 Gameplay 上的 overlay，也可以是独立完整画面；本 ADR 不提前强制其唯一 presentation。

Scene policy 继续维护：

```text
suggestedScene
activeScene
mode = auto | manual
```

`suggestedScene` 应由稳定后的 RuntimeTransition / state policy 推导，不应直接因为一次 partial GSI payload 瞬时跳场景。

---

## 9. Radar domain 与 Radar renderer 分离

`packages/radar` 应拥有 framework-neutral 的：

```text
RadarFrame / projection
world → radar transform
MapGeometryProvider contract
floor selection
marker / utility semantics
interpolation math
autozoom math
```

Web presentation 层拥有：

```text
React / SVG / Canvas / DOM renderer
CSS/theme
requestAnimationFrame scheduling
OBS/browser-specific rendering details
```

地图几何通过 `MapGeometryProvider` 进入 Radar；当前默认 provider 计划复用 DAK `@cs2dak/maps`，但 Radar 不直接把 DAK package shape 作为自己的 domain contract。

Boltobserv / Obserview 等用于算法与产品 UX 参考，不作为第二套 GSI runtime/sidecar。

---

## 10. 跨仓 contract ownership

### Broadcast-owned local contract

Broadcast 自己拥有：

```text
Companion ↔ Program
Companion ↔ Operator
Companion ↔ Debug
```

这些 versioned local DTO / schema 可以放在 `packages/protocol`。

### RivalHub-facing API contract

RivalHub 主仓拥有它公开的 API boundary 与长期服务端语义：

```text
BroadcastManifest API
#610 Reliable Observation ingest
#615 Live Snapshot ingest
```

Broadcast 的 `packages/rivalhub` 作为 consumer/producer adapter：

- 使用公开 machine-readable schema / documented contract；
- 可以生成或维护本地 validator/client；
- 使用 compatibility fixture 做跨仓验证；
- 不 import RivalHub 源码类型；
- 不直连 RivalHub / Supabase 内部表。

这不是“HTTP receiver 天然拥有一切”的普遍规则，而是本系统中 RivalHub 作为公开 API/provider 与 canonical authority 的具体边界。

术语固定为：

```text
BroadcastLiveSnapshot
  Broadcast → RivalHub #615 的 producer payload

EphemeralLiveProjection
  RivalHub #615 服务端维护的当前实时投影

PublicLiveMatchProjection
  RivalHub 公共页面消费的公开 read model
```

不要在 Broadcast 侧把 producer payload 也称为 `LiveProjection`。

---

## 11. Local security baseline

在只做 localhost M0/M1 时保持最小 surface；一旦进入 pairing、LAN 或 RivalHub uplink，必须满足：

```text
default bind = 127.0.0.1
LAN mode = explicit opt-in

GSI token
!= local operator credential
!= RivalHub producer credential
```

并要求：

- local mutation endpoint 校验 Origin / session / protocol；
- WebSocket 校验 Origin 与 protocol version；
- RivalHub credential scope 到 producer/season/match，不使用 service-role；
- credential 不写入普通 logs / fixtures；
- Debug/fixture 导出需处理 token 与不必要的个人数据；
- 不能为了第二台电脑访问 Operator 就默认把服务无保护暴露到 `0.0.0.0`。

具体 pairing/credential storage 仍需后续 ADR。

---

## 12. 实施 Gate

完整产品 scope 不缩减，但按可验证 vertical slice 推进：

```text
M0 Runtime proof
GSI → production normalizer → /debug
raw recorder / replay
session / clock / transition 基础

M1 Production kernel
RivalHub manifest
identity / wrong-match
basic Gameplay + player/bomb Radar
reconnect / backpressure
2h soak

M2 Broadcast workflow
utility（grenade/smoke/inferno）
provisional stats
Waiting / Matchup / BP / Halftime / MapResult / InterMap / MatchResult

M3 RivalHub uplink
#610 ReliableObservation
#615 BroadcastLiveSnapshot
pairing / auth / outbox / security hardening

M4 Enhanced telemetry
exact damage source
BombDamageProvider
advanced observer advisory / effects / optional adapters
```

“不做一次性 MVP”不等于所有能力必须同时实现。每一 Gate 都必须用真实生产链路产生可验证证据。

---

## 后果

### 正面

- Core 不会演化成一个通过 WebSocket 到处发送的 God Object；
- 高频 Radar/position 不拖累低频 UI；
- reliable observation 可以安全重试，同时不把离线 command 变成危险自动执行；
- Wrong Match、restart、reconnect、slow consumer 的行为可测试；
- #610 / #615 与 Broadcast 的 authority/terminology 清晰；
- Radar、renderer、scene effect 可以独立演进。

### 代价

- 需要显式 projector、identity/session model 与 outbox；
- 测试必须覆盖更多故障语义，而不只是 happy path；
- local protocol 与 RivalHub-facing contract 不再混成一个 `packages/protocol`。

这些复杂度是为了避免直播系统最难排查的长期延迟、错场写入、离线错误重放和跨仓耦合。