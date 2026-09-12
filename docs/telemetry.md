# Telemetry / GSI 设计基线

> 状态：**M1 Design Baseline**。本文冻结进入 M1 前已经足够明确的 Telemetry / GSI 设计；凡是必须依赖真实 Windows + CS2 spectator 数据才能确认的行为，明确标为“待真实 capture 验证”，不把推测写成既定事实。
>
> 本文服从 ADR-0001～0003 的 authority、RuntimeState、identity、time 与 delivery invariant；如与 `docs/architecture.md` 中较早的 package ownership 简写冲突，以本文关于 telemetry / capture / replay 的更具体说明为准。

## 1. 用人话先说明：这一层到底在做什么

CS2 会不断把“我现在看到的比赛状态”通过 GSI HTTP POST 发给 Companion。这个输入并不是 RivalHub 的官方比赛结果，也不是可以直接给 HUD 使用的一份完整业务状态。

M1 要解决的是：

```text
CS2 发来的原始 GSI
        ↓
先可靠接住、记录、补全 partial update
        ↓
翻译成不带 Valve/GSI 特有细节的 NormalizedTelemetry
        ↓
交给 Core
        ↓
Core 再决定 RuntimeState / transition / identity / scene 等业务语义
```

因此最重要的原则是：

> **GSI adapter 负责“把 CS2 说的话翻译清楚”；Core 负责“这些观测对比赛运行意味着什么”。**

不要让一个 GSI library 直接替 Core 决定 `round_started`、`map_ended`、`bomb_planted` 等 Broadcast domain transition。

---

## 2. 目标数据流

```text
CS2
 │ HTTP POST
 ▼
apps/companion — GSI ingress
 │
 │ auth / request limits / receive timestamps
 │
 ├──────────────► Production Capture Recorder
 │                 sanitized raw payload
 │                 + monotonic pacing metadata
 │
 ▼
packages/telemetry-gsi
 │
 │ tolerant parse / validation
 │ partial-frame source-state merge
 │ GSI-specific diagnostics
 │ normalization
 ▼
packages/core — Core-owned TelemetryObservation / NormalizedTelemetry contract
 │
 ▼
RuntimeState / RuntimeTransition / identity / accumulators
```

### 为什么要分这么多层

如果 HTTP、GSI partial merge、比赛 transition、HUD 状态全部写进一个处理函数，短期很快，但后面会出现三个问题：

1. replay 很难复现生产路径；
2. Valve 字段变化会直接污染整个 Runtime；
3. 很难判断一个 bug 是“CS2 数据问题”还是“我们业务逻辑问题”。

M1 的目标不是追求类和文件越多越好，而是把这三个责任边界分清。

---

## 3. Ownership

### `packages/core`

Core 拥有 telemetry 进入 domain 的稳定输入 contract，例如概念上的：

```text
TelemetryObservation
├─ seq
├─ receivedAt              UTC wall clock
├─ receivedMonotonic       process-local monotonic time
├─ source
│  ├─ kind = cs2-gsi
│  ├─ providerTimestamp?
│  └─ capabilities
├─ telemetry
│  ├─ map
│  ├─ phase
│  ├─ round
│  ├─ sides
│  ├─ players
│  ├─ observedPlayer
│  ├─ bomb
│  └─ grenades
└─ diagnostics
```

这里的名字只是当前语义草图；最终 TypeScript 字段在第一张 M1 implementation Issue 中收敛。

Core contract **不得**出现：

```text
GSI 的 auth / previously / added
Valve-specific raw shape
Fastify Request
matchId / liveSessionId / RivalHub team identity
official result
```

原因：后四类事实需要 Core 与 RivalHub context 组合之后才能确定，不能让 GSI adapter 猜。

### `packages/telemetry-gsi`

拥有：

- Raw CS2 GSI schema / tolerant parser；
- GSI partial update 的 source-state merge；
- GSI-specific diagnostics；
- Raw GSI → Core-owned normalized telemetry 的 adapter。

Raw GSI type 不得泄漏给 `packages/core`、`apps/web` 或 RivalHub adapter。

推荐依赖方向：

```text
packages/telemetry-gsi
        ↓
packages/core
```

也就是 adapter 依赖 Core 定义的 input contract；Core 不知道 GSI 的存在。

### `apps/companion`

拥有：

- GSI HTTP ingress；
- GSI token / body size / local endpoint policy；
- 接收时的 monotonic + wall-clock timestamp；
- production capture recorder；
- telemetry-gsi 与 Core 的 composition。

### `packages/testkit`

拥有：

- capture reader；
- ReplayClock；
- replay runner；
- simulator；
- fault injection；
- fixture tooling。

**不拥有生产 recorder。**

这条说明修正 `docs/architecture.md` 早期把 `recorder` 简写在 `testkit` 下的表述：真实 Windows + CS2 运行时需要 production recorder，而生产 app 不应 runtime-depend on testkit。testkit 消费 capture 做测试，不反向成为生产依赖。

---

## 4. Raw GSI 与 partial update 语义

CS2 GSI 不是每个 POST 都完整重复所有状态。Adapter 必须维护一份 **GSI source state**，把连续 partial frame 合并成当前完整观测。

这份 `GsiSourceState` 只是 source-side reconstruction，不是第二份 `RuntimeState`。

第一版采用以下语义，并要求之后用真实 capture 验证：

```text
top-level block absent
→ unchanged

普通 object field absent
→ unchanged

allplayers / grenades / weapons 等 collection block 出现
→ 视为该 collection 的当前集合
→ block 内消失的 entry 可以从 source state 移除

某能力因 cfg / spectator context 根本不可用
→ unavailable
→ 不能伪装成 empty / zero / false
```

### `previously` / `added`

Raw capture 可以保留 Valve 原始 payload 中的 `previously` / `added` 以便 diagnostics 与兼容性调查；但：

- 不把它们暴露为 Core contract；
- 不把它们直接当 RuntimeTransition；
- Core transition 必须由稳定后的 normalized observation + RuntimeState 推导。

### Unknown 不等于 0

必须保持：

```text
unknown ≠ 0
unknown ≠ false
unknown ≠ []
```

例如没有观测到 armor、grenade collection 或 phase，不应该为了类型方便填成 `0`、空数组或任意默认 enum。

---

## 5. Validation / forward compatibility

Telemetry adapter 应“严格结构、宽容新值”。

### 应拒绝或降级为 invalid frame

例如：

- body 根本不是可解析 JSON object；
- 关键字段类型完全错误；
- 数值/对象形态破坏到无法安全理解。

### 不应因为以下情况把整帧丢掉

例如 Valve 未来增加：

- 新 phase 字符串；
- 新 weapon / grenade type；
- 新 bomb state；
- 当前代码不认识的附加字段。

未知 enum/string 可以保留 raw value，并把对应高级语义标为 unknown/degraded；不要因为一个未来新值让其他健康的 map/player state 一起消失。

---

## 6. Time 语义

遵守 ADR-0003：

```text
monotonic clock
→ “过去了多久”
→ staleness / timeout / replay pacing / interpolation

UTC wall clock
→ “什么时候发生”
→ receivedAt / logs / audit / cross-machine evidence
```

GSI `provider.timestamp` 可以作为 source evidence，但不能替代 Companion 自己的 monotonic receive clock。

第一版 `TelemetryObservation.seq` 是 Companion/process scope 下的接收序列，用于本地 diagnostics/replay；不要提前把它等同于后续 RivalHub #610/#615 的 wire sequence。

---

## 7. Production Capture Recorder

### 为什么一定要录 Raw GSI

真实 CS2 + spectator 环境昂贵而且难重复。Recorder 的目的不是保存比赛历史，而是把一次真实运行转换成之后可在 Mac / CI 反复使用的测试输入：

```text
真实 Windows + CS2
        ↓ 一次 capture
sanitized raw corpus
        ↓ 无限次 replay
Mac / Linux / Windows CI
```

因此 capture 记录的是 **accepted raw GSI**，不是已经 normalized 的输出。这样 parser / merge / normalizer 未来改动时仍然可以重新验证。

### 建议格式

```text
captures/<capture-id>/
├─ manifest.json
└─ frames.jsonl
```

`manifest.json` 至少表达：

```text
formatVersion
captureId
createdAt
platform / Windows version
CS2 build/version（可获得时）
Broadcast commit
scenario / notes
sanitized GSI config
complete
frameCount
droppedFrames
```

每个 `frames.jsonl` record 至少表达：

```text
v
seq
elapsedUs       ← monotonic pacing
receivedAt      ← UTC evidence
payload         ← sanitized raw GSI
```

### 敏感信息

写入 capture 前至少永久移除：

```text
auth.token
```

进入 Git 仓库的 fixture corpus 还必须经过 deterministic sanitizer，避免真实 SteamID、observer account、玩家姓名等个人数据无意长期进入测试资产。

### Recorder failure 不能拖死直播

Recorder 必须是 bounded writer：

```text
正常
→ 连续写盘

磁盘/写入跟不上
→ bounded queue 达上限
→ 标记 capture incomplete / droppedFrames > 0
→ 产生 diagnostic incident
→ telemetry runtime 继续工作
```

禁止通过无限 RAM queue 保证“一个 frame 都不能掉”，也禁止为了 recorder 把 GSI ingress 长时间阻塞。

不完整 capture 不能被标为 gold/reference fixture。

---

## 8. Replay / Simulator

Replay 的核心原则：

> **记录下来的生产输入必须重新走 production telemetry adapter。**

不要创建一条“测试专用 normalized state 注入”捷径，让测试绕过真正容易出错的 parser/merge/normalizer。

### Layer A — deterministic replay

```text
frames.jsonl
→ ReplayClock
→ same GSI adapter accept path
→ Core
```

主要供 unit / integration / CI。

第一版至少支持：

```text
step
1x
Nx accelerated
```

### Layer B — ingress integration replay

少量测试可以：

```text
frames.jsonl
→ HTTP POST /gsi
→ real Companion ingress
→ same telemetry adapter
```

用来验证 Fastify body parsing、auth、limits 与 composition。

### 后续 fault injection

在相同 capture 基础上再增加：

```text
drop
duplicate
jitter
reorder
disconnect / reconnect
```

不需要第一张 M1 Issue 一次做完。

---

## 9. GSI configuration 策略

### Reference Capture Profile

为了首先弄清楚“CS2 实际能给我们什么”，第一份真实 capture 优先采用低 buffer / 低 throttle 的高保真 profile，并请求 observer 场景需要的完整字段，例如：

```text
provider
map
map_round_wins
round

player_id
player_state
player_match_stats
player_weapons
player_position

allplayers_id
allplayers_state
allplayers_match_stats
allplayers_weapons
allplayers_position

phase_countdowns
bomb
allgrenades
```

`tournamentdraft` 不作为核心输入。BP 仍由 RivalHub canonical domain 拥有，Broadcast 只负责 presentation playback。

### 生产频率暂不冻结

第一版不要在架构里硬编码生产必须是 `0/0`、10 Hz 或 20 Hz。

真实 capture 后再根据：

- 实际 update cadence；
- payload size；
- CPU / GC；
- HUD/Radar 平滑度；
- 是否出现大量 no-op frame；

决定正式赛事 profile。

也就是说：

> **Reference capture 先追求看清现实；production profile 再追求足够低延迟且稳定。**

---

## 10. Real GSI Reference Capture Pack

一旦最小 recorder 可用，应尽快在真实 Windows + CS2 spectator 环境采集第一套 corpus。

至少覆盖：

```text
normal round
kill / damage
bomb plant / defuse / explode
grenade / smoke / molotov/inferno
warmup / freezetime / live / round over
halftime / side switch
map end / map change
disconnect / reconnect
restart（可行时）
```

这一步不是“再写一遍 Windows 版本代码”，而是验证以下仍然不能仅靠文档确定的事实：

- CS2 当前真实 payload shape；
- partial update / collection replacement 语义；
- spectator-only field 实际可用性；
- update cadence；
- provider timestamp 行为；
- 新/未知 enum；
- map/round/reconnect 边界行为。

真实 capture 结论如果与本文假设冲突，应修正 adapter/spec，而不是为了保持文档漂亮去兼容错误假设。

---

## 11. M1 初始 package graph

第一批真实 dependency 建议为：

```text
packages/core
  ↑
packages/telemetry-gsi
  ↑
apps/companion

packages/core + packages/telemetry-gsi
  ↑
packages/testkit   (dev/test only for production owners)
```

更具体地：

```text
core
  owns normalized telemetry contract

telemetry-gsi → core
  implements CS2 GSI adapter

companion → telemetry-gsi + core
  HTTP ingress + recorder + composition

testkit → telemetry-gsi + core
  replay / simulator / fault injection
```

`apps/web` 不消费 Raw GSI；`packages/protocol` 第一阶段也不因为 telemetry implementation 被强行拉进依赖图。

### 第一个真实 workspace edge 与 build graph

M0 时 package 之间没有真实 runtime dependency，因此跨 package clean-tree build 尚未被验证。

第一张产生 `telemetry-gsi → core` 的 M1 implementation PR 必须证明：

```text
fresh clone / clean dist
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

可以在真实 workspace dependency 存在时稳定通过。

如果当前独立 `tsc` + `dist` exports 无法满足，应在该 PR 中以最小方式引入正确的 TypeScript project/build graph；不要通过 `paths` alias 或直接 import 其他 package 的 `src` 绕过问题。

---

## 12. 第一批 M1 工作切分（设计方向，不等于已创建 Issue）

建议顺序：

```text
1. Telemetry Contract & Adapter Foundation
   Core-owned normalized contract
   + GSI raw parser / partial merge / normalizer
   + first real workspace edge/build graph

2. GSI Ingress & Production Capture Recorder
   Companion /gsi
   + token/limits/timestamps
   + bounded raw recorder / sanitizer contract

3. Replay / Fixture Runtime
   testkit capture reader
   + ReplayClock
   + step / 1x / Nx
   + same production adapter

4. Real CS2 Reference Capture Pack
   Windows + CS2 spectator validation
   + real corpus
   + adapter/spec corrections

5. Runtime Skeleton & Debug Projection
   producer instance / session / map epoch/time primitives
   + RuntimeState reducer
   + first RuntimeTransition
   + basic latest-wins in-process delivery
```

推荐依赖关系：

```text
#1 Contract / Adapter
        ↓
#2 Ingress / Recorder ──► #4 Real Capture
        ↓                     │
#3 Replay ◄───────────────────┘
        ↓
#5 Runtime Skeleton
```

#2 与 #3 可以在 #1 完成后并行；#4 在 recorder 能工作后尽早执行，不需要等待 M1 全部实现结束。

---

## 13. M1 明确不做什么

本阶段不要顺手扩张为：

```text
完整 HUD / Radar renderer
RivalHub #610 / #615 uplink
完整 WebSocket browser protocol
scene engine
observer camera control
HLAE / server-event sidecar
DAK postmatch integration
云端 raw GSI history
通用 event sourcing
```

M1 的价值是先让“真实 CS2 输入 → 可重复、可验证的本地 runtime 输入”这条链稳定。

---

## 14. 当前已冻结 vs 待验证

### 已冻结

- Raw GSI 不进入 Core/Web；
- Core 拥有 normalized telemetry contract；
- telemetry-gsi 维护 source-side partial state 并做 normalization；
- domain transition 属于 Core，不属于 GSI library；
- unknown 不伪装成 zero/empty；
- validation 要能容忍未来新增 enum/string；
- duration/pacing 用 monotonic clock，UTC 只表达时间点；
- production capture 记录 sanitized raw GSI；
- production recorder 不属于 testkit；
- replay 必须走 production telemetry adapter；
- recorder queue bounded，失败不能拖死 live runtime；
- production GSI update rate 暂不硬编码。

### 待真实 Windows + CS2 capture 验证

- 当前 CS2 每个 block 的精确 partial/replace 行为；
- collection deletion 的全部 corner case；
- spectator-only fields 的实际 shape / cadence；
- 推荐 production buffer/throttle；
- unknown/current enum corpus；
- map restart / reconnect / halftime 等实际边界序列；
- payload volume 与 recorder throughput。

---

## 15. 参考

设计时主要对照：

- Valve / community-maintained Counter-Strike Game State Integration documentation；
- Eon HUD 的 GSI configuration、raw JSONL recorder 与 replay simulator；
- 现代 TypeScript CS2 GSI libraries 对 partial state merge / unknown enum / spectator field 的处理；
- 本仓 ADR-0002 / ADR-0003 与 `docs/development-validation.md`。

第三方项目用于验证现实问题与吸收经验，不作为本仓 Runtime domain model 的 owner。
