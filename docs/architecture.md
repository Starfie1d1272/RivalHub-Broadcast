# 初始架构边界

> 状态：**Baseline**。本文只记录已经足够明确、值得在仓库初始化时固定的边界。具体协议字段、transport、技术栈版本和 packaging 将通过后续 ADR 逐项冻结。

## 1. 架构目标

RivalHub Broadcast 应是一套 local-first、event-driven、capability-aware 的 CS2 Broadcast Runtime。

架构优先级按顺序为：

1. 长时间直播不积压、不越来越延迟；
2. 官方赛事事实与本地观测严格分权；
3. Wrong Match / stale / reconnect 能安全降级；
4. 可复现、可回放、可测试；
5. HUD / Radar / scene 能持续扩展；
6. 第三方能力通过 adapter/capability 接入，不污染 core。

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
  identity / epoch / state / events / accumulator / scenes / capabilities
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
Presentation Plane        Uplink Plane
Program / Operator        RivalHub live projection
Debug / Radar / HUD       result candidate / health
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
- Stage / Bracket progression。

### Broadcast

拥有本地运行态：

- telemetry ingress；
- normalized observation；
- runtime session / epoch；
- HUD / Radar；
- scene / presentation state；
- provisional stats；
- local diagnostics / cache / replay。

### DAK / OCR

负责赛后 evidence 和更高质量统计，不作为低延迟 HUD 主循环依赖。

## 4. 初始 package ownership

```text
apps/companion
  本地 composition root。组装 HTTP、telemetry、RivalHub adapter、core、web output。

apps/web
  /operator /program /debug 的 UI。

packages/protocol
  versioned wire schema / DTO / fixture contract。不得包含产品运行时状态机。

packages/core
  纯 TypeScript domain/runtime core：reducer、identity、epoch、event journal、accumulator、scene suggestion。
  禁止依赖 React、HTTP server、WebSocket 实现、OBS、RivalHub DB 或具体 GSI library。

packages/telemetry-gsi
  Raw CS2 GSI → normalized telemetry。Raw GSI 类型不得泄漏出该 package。

packages/rivalhub
  Manifest / pairing / live uplink / canonical command integration。
  只能通过公开 contract 工作，不直连 RivalHub/Supabase 表。

packages/radar
  Radar projection、marker/utility model、animation hot path；地图 calibration 优先复用 DAK owner。

packages/renderer-major
  RivalHub Major 的节目 renderer。视觉主题不得反向定义 core state。

packages/testkit
  recorder、replay、simulator、fault injection、fixtures。
```

## 5. Realtime 基本语义

无论最终采用一个还是多个物理 WebSocket，内部必须先区分两种语义：

### Snapshot

```text
latest-wins
bounded
droppable
```

适合 HP、money、position、clock、bomb position 等高频可覆盖状态。慢 consumer 不得排队回放旧 snapshot。

### Event

```text
ordered
deduplicated
replayable when meaningful
```

适合 round/map boundary、operator command、result candidate、identity warning 等事件。

“Snapshot/Event 双语义”是架构 invariant；“一个还是两个物理 socket”不是。

## 6. Renderer 边界

Renderer 消费 Broadcast 自己定义的 normalized state / presentation model，不消费 Raw GSI，不直接调用 RivalHub API。

React 负责 scene composition、结构布局与低频 UI；Radar marker、utility movement 等高频动画允许使用 requestAnimationFrame + imperative update，避免把每个 GSI tick 变成整棵 React rerender。

## 7. Identity 原则

稳定身份：

```text
CompetitionEntry
RivalHub User / Steam64
```

临时身份：

```text
CT / T
observer_slot
```

Core 必须显式维护 side → CompetitionEntry mapping；换边不能改变赛事身份。

## 8. Capability 原则

高级能力必须可声明真实可用性，例如：

```text
telemetry.gsi
telemetry.damage-source
radar.utility-timer
bomb.damage-prediction
observer.camera-control
obs.control
```

Renderer 只能在 capability 成立时展示需要该数据精度的效果。

## 9. Local-first 原则

RivalHub 暂时不可达不能让已运行的 Program 立即失效。本地需要 last-known-good match context、必要节目资产和 compact recovery state。

但离线时不得自动积压高影响 canonical mutation 并在恢复网络后静默重放。

## 10. 当前尚未冻结的事项

以下内容需要后续逐项 ADR：

- `BroadcastManifest` 精确字段；
- `BroadcastState` / `RuntimeEvent` schema；
- HTTP/WS transport 的最终形态；
- RivalHub pairing / credential storage；
- cloud live uplink endpoint 与 rate；
- Radar asset 来源与生成流程；
- `@cs2dak/maps` 的消费方式；
- GSI parser dependency 的最终选择；
- Node/Bun 等 runtime 的最终版本基线；
- Electron / Tauri / ordinary launcher 的 packaging 决策；
- Enhanced telemetry 与 server plugin 的范围；
- C4 damage provider；
- OBS WebSocket；
- 第三方 HUD compatibility。

这些事项在有足够证据前不得因为“参考项目这样做”而自动成为仓库约定。
