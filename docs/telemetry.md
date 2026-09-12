# Telemetry / GSI 设计基线

> 状态：**M1 Design Baseline**。
>
> 本文定义 RivalHub Broadcast 在 M1 阶段的 Telemetry / CS2 Game State Integration（GSI）边界、数据语义、capture/replay 约束与真实环境验证要求。本文服从 ADR-0001～0003 中已经接受的 authority、RuntimeState、identity、time 与 delivery invariant。
>
> 对于必须依赖真实 Windows + CS2 spectator 运行才能确认的行为，本文明确标记为“待真实 capture 验证”；这些内容在获得真实证据前不得被实现视为既定协议事实。

## 1. 目标与范围

M1 Telemetry 层负责建立以下稳定链路：

```text
CS2 Raw GSI
    ↓
Companion GSI ingress
    ↓
GSI source-state reconstruction
    ↓
Normalized Telemetry
    ↓
Broadcast Core
```

目标是将 CS2 提供的 source-specific、partial、可能随版本变化的 GSI 输入，转换为 Core 可以稳定消费的 telemetry observation，同时保留完整的可验证性与可重放性。

本阶段重点解决：

- Raw GSI 接收与 source ownership；
- partial update reconstruction；
- Raw GSI → normalized telemetry 的 adapter boundary；
- 时间、序列、unknown/unavailable 语义；
- production capture 与 replay；
- 真实 Windows + CS2 spectator reference corpus；
- 第一个真实 workspace dependency 出现后的 build graph 验证。

本阶段不负责：

- RivalHub #610 / #615 uplink；
- canonical Match / Map result；
- 完整 RuntimeState / Scene Engine；
- Program / Radar renderer；
- browser realtime transport；
- observer camera control；
- HLAE / server-event sidecar；
- DAK postmatch evidence pipeline。

---

## 2. 核心设计原则

### 2.1 Source adapter 与 domain semantics 分离

GSI adapter 负责：

```text
parse
validate
partial-state reconstruction
normalize
source diagnostics
```

Broadcast Core 负责：

```text
RuntimeState
RuntimeTransition
session / identity
map epoch
accumulators
scene policy
capability
```

因此，GSI adapter 不直接拥有或输出 Broadcast domain transition，例如：

```text
round_started
round_ended
map_started
map_ended
bomb_planted
side_changed
```

这些 transition 必须由 Core 根据 normalized observation 与现有 RuntimeState 推导。

第三方 GSI library 即使提供 change/event API，也不得成为 Broadcast domain transition 的 owner。

### 2.2 Raw GSI 不泄漏到 Core / Web / RivalHub adapter

Raw GSI schema、Valve 字段名、`previously`、`added` 等 source-specific 结构限定在 `packages/telemetry-gsi` 及 capture/replay tooling 边界内。

Core、Web、RivalHub adapter 不直接依赖 Raw GSI 类型。

### 2.3 Normalized telemetry 是 observation，不是 RuntimeState

`NormalizedTelemetry` / `TelemetryObservation` 表示：

> 当前 telemetry source 能够提供的、已经完成 source reconstruction 与 normalization 的观测。

它不包含：

- RivalHub canonical identity；
- official lifecycle / result；
- liveSessionId 的最终可信绑定；
- scene state；
- operator override；
- accumulator 结果。

这些语义属于 Core 与 RivalHub context 组合后的 runtime 层。

### 2.4 Replay 必须经过 production adapter

真实 capture 的 replay 不得直接注入“测试专用 normalized state”。

生产输入与 replay 输入必须复用同一条 telemetry adapter 路径，以便 parser、partial merge、normalization 与兼容性逻辑能够被真实 corpus 持续验证。

---

## 3. 目标数据流

```text
CS2
 │ HTTP POST
 ▼
apps/companion — GSI ingress
 │
 │ authentication / request limits
 │ receive monotonic timestamp
 │ receive UTC timestamp
 │
 ├──────────────► Production Capture Recorder
 │                 sanitized raw frame
 │                 + capture timing metadata
 │
 ▼
packages/telemetry-gsi
 │
 │ raw parsing / tolerant validation
 │ source-state reconstruction
 │ GSI-specific diagnostics
 │ normalization
 ▼
packages/core
 │ Core-owned telemetry input contract
 ▼
RuntimeState / RuntimeTransition / identity / accumulators
```

Production capture 与 runtime processing 共享同一个 accepted raw input，但 recorder 不得成为 telemetry processing 的前置阻塞条件。

---

## 4. Package ownership

### 4.1 `packages/core`

Core 拥有 telemetry 进入 domain 的稳定输入 contract。

概念上，该 contract 至少需要表达：

```text
TelemetryObservation
├─ sequence
├─ receivedAt
├─ receivedMonotonic
├─ source
│  ├─ kind
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

以上是语义结构，不是最终 TypeScript schema。字段与类型在第一张 M1 implementation Issue 中根据真实实现进一步收敛。

Core contract 不应出现：

```text
GSI auth
GSI previously / added
Valve-specific raw payload shape
Fastify Request / Reply
RivalHub Match object
RivalHub canonical result
```

### 4.2 `packages/telemetry-gsi`

负责：

- Raw CS2 GSI schema；
- tolerant parser / validator；
- partial source-state reconstruction；
- GSI-specific diagnostics；
- Raw GSI → Core-owned telemetry contract 的 normalization adapter。

初始依赖方向：

```text
packages/telemetry-gsi
        ↓
packages/core
```

Core 不反向依赖 `packages/telemetry-gsi`。

### 4.3 `apps/companion`

负责：

- GSI HTTP ingress；
- GSI token validation；
- request/body size policy；
- request receive timestamps；
- production capture recorder；
- telemetry-gsi 与 Core 的 composition；
- telemetry ingress health / diagnostics 的 process-level owner。

### 4.4 `packages/testkit`

负责：

- capture reader；
- ReplayClock；
- replay runner；
- simulator；
- fault injection；
- fixture transformation / sanitization tooling；
- deterministic replay assertions。

`packages/testkit` **不拥有 production recorder，也不得成为 production runtime dependency**。

`docs/architecture.md` 中较早的 `testkit = recorder / replay / simulator / ...` 表述，在 telemetry / capture ownership 上由本文收敛为：

```text
production capture recorder
→ apps/companion telemetry runtime

capture consumption / replay / simulation
→ packages/testkit
```

---

## 5. Raw GSI ingestion boundary

第一版 GSI ingress 应保持最小职责：

1. 接收 CS2 HTTP POST；
2. 执行本地 GSI authentication；
3. 应用 body/request limit；
4. 记录接收时间；
5. 将 accepted raw payload 同时交给 recorder 与 telemetry adapter；
6. 快速返回，不在 request path 中执行重型业务逻辑。

Ingress 不负责：

```text
RivalHub match binding
RuntimeTransition derivation
scene selection
cloud uplink
HUD projection
```

默认监听仍遵守本仓安全基线：

```text
127.0.0.1
```

LAN exposure 不属于 M1 telemetry baseline 的默认行为。

---

## 6. Raw GSI 与 source-state reconstruction

### 6.1 Partial update model

CS2 GSI 应视为 partial state feed，而不是“每个 POST 都包含完整比赛状态”。

`packages/telemetry-gsi` 因此维护一份 source-local `GsiSourceState`，用于将连续 GSI frame 重建为当前完整 source observation。

`GsiSourceState`：

- 是 adapter 内部状态；
- 不属于 Core RuntimeState；
- 不直接暴露到 renderer；
- process/replay reset 时必须可显式重置。

### 6.2 初始 merge semantics

在真实 capture 完成前，采用以下初始语义作为 implementation hypothesis：

```text
top-level block absent
→ previous source value remains unchanged

ordinary nested field absent
→ previous source value remains unchanged

collection block explicitly present
→ represents current source-side collection for that block
→ entries absent from the new collection may be removed

capability unavailable because of cfg / spectator context
→ unavailable
→ must not be represented as empty / zero / false
```

其中 collection replacement / deletion 的精确 corner case 必须通过真实 Windows + CS2 spectator capture 验证。

### 6.3 `previously` / `added`

Raw capture 可以保留 CS2 payload 中的：

```text
previously
added
```

用途限定为：

- source diagnostics；
- compatibility investigation；
- corpus analysis；
- parser regression evidence。

它们不得：

- 直接进入 Core telemetry contract；
- 直接映射为 RuntimeTransition；
- 成为 canonical result evidence 的唯一来源。

---

## 7. Unknown / unavailable semantics

Telemetry model 必须区分：

```text
known value
unknown value
unavailable capability
empty collection
zero / false
```

以下等价关系均禁止：

```text
unknown == 0
unknown == false
unknown == []
unavailable == empty
```

例如：

- 未观测到 armor 不等于 armor = 0；
- grenade capability 不可用不等于当前 grenades = []；
- phase 字段不可解释不等于任意默认 phase；
- observer-only field 缺失不应伪装成正常空值。

Normalized contract 应通过 optional / nullable / discriminated availability 等明确方式表达缺失语义，而不是依赖 magic default。

---

## 8. Validation 与 forward compatibility

Telemetry parser 应遵守：

> **结构约束严格；新增 source value 宽容。**

### 8.1 Invalid frame

以下情况可以判定 frame invalid 或产生明确 degraded diagnostic：

- body 不是 JSON object；
- 关键字段类型与结构不可解析；
- 数值或对象 shape 已破坏到无法安全读取；
- payload 超出 ingress policy 限制。

### 8.2 Unknown future values

以下变化不应导致整帧被丢弃：

- 新 phase string；
- 新 weapon type；
- 新 grenade type；
- 新 bomb state；
- 新附加字段；
- 已知 block 中出现尚未识别的 enum/string value。

对未知 source value，应优先：

1. 保留 raw value 供 diagnostics；
2. 将无法确定的高级语义标记为 unknown/degraded；
3. 保留同一 frame 中其他仍然有效的 telemetry。

禁止因为一个未知 enum 导致整份 map/player/bomb state 丢失。

---

## 9. Time 与 sequence semantics

时间语义服从 ADR-0003。

### 9.1 Monotonic time

用于：

```text
staleness
timeout
replay pacing
interpolation
ingress interval measurement
```

推荐来源包括：

```text
performance.now()
process.hrtime.bigint()
```

### 9.2 UTC wall clock

用于：

```text
receivedAt
loggedAt
audit / diagnostics
cross-machine evidence
capture metadata
```

### 9.3 Provider timestamp

GSI `provider.timestamp` 可以保留为 source evidence，但不作为本地 timeout / staleness 的唯一时钟。

### 9.4 Local sequence

M1 初始 `TelemetryObservation.sequence` 表示 Companion / producer process 内的接收顺序。

该 sequence：

- 主要服务 diagnostics、replay 与 local ordering；
- 不提前等同于 RivalHub #610 / #615 的 wire sequence；
- process restart 后的 continuity 由后续 `producerInstanceId` / session semantics 处理。

---

## 10. Production Capture Recorder

### 10.1 Purpose

Production capture 的目标是将昂贵、难重复的真实 Windows + CS2 spectator 输入转换为可重复执行的测试证据。

Capture 不是官方比赛历史，也不是长期 telemetry data warehouse。

应记录 **accepted raw GSI input**，而不是只记录 normalized output，以保证 parser、merge、normalization 未来发生变化后仍可对原始现实输入重新验证。

### 10.2 Physical format

初始格式：

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
platform
windowsVersion?
cs2Build?
broadcastCommit
scenario
notes?
gsiConfig
complete
frameCount
droppedFrames
```

每条 `frames.jsonl` record 至少表达：

```text
version
sequence
elapsedUs
receivedAt
payload
```

其中：

```text
elapsedUs
→ monotonic capture pacing

receivedAt
→ UTC evidence timestamp
```

### 10.3 Sanitization

写入 capture 时必须永久移除：

```text
auth.token
```

进入仓库的 fixture/reference corpus 还必须执行 deterministic sanitization，至少覆盖：

- SteamID / Steam64；
- observer account identity；
- player display name；
- 其他不需要长期进入 fixture 的个人或赛事敏感字段。

Sanitizer 必须保持稳定映射，使跨 frame identity continuity 不被破坏。

### 10.4 Recorder backpressure

Recorder 不能通过无限内存队列保证“绝不丢 frame”。

要求：

```text
bounded writer queue
```

当磁盘或 writer 无法跟上 ingress 时：

1. runtime telemetry processing 继续；
2. recorder 不无限占用 RAM；
3. capture 标记为 incomplete；
4. `droppedFrames` 可观测；
5. 产生明确 diagnostic / incident；
6. incomplete capture 不得作为 gold/reference fixture。

Recorder failure 不应阻塞 live telemetry path。

---

## 11. Replay / simulator

### 11.1 Deterministic replay

主要 CI / integration replay 路径：

```text
capture frames
→ ReplayClock
→ production GSI adapter accept path
→ normalized telemetry
→ Core
```

第一版 ReplayClock 至少支持：

```text
step
1x realtime
Nx accelerated
```

### 11.2 HTTP ingress integration replay

少量 integration test 额外覆盖：

```text
capture frames
→ HTTP POST /gsi
→ Companion ingress
→ production GSI adapter
```

该路径用于验证：

- Fastify request/body parsing；
- auth；
- payload limits；
- ingress composition；
- recorder/adapter fan-out。

它不是所有 replay test 的默认执行方式。

### 11.3 Fault injection

后续可在同一 capture corpus 上增加：

```text
drop
duplicate
jitter
reorder
disconnect
reconnect
```

Fault injection 不要求在第一张 M1 implementation Issue 中全部完成。

---

## 12. GSI configuration baseline

### 12.1 Reference Capture Profile

第一份真实 reference capture 应优先请求 observer/broadcast 场景所需的高保真字段，包括：

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

如果真实 CS2 当前对字段名称或支持情况已有变化，应以实际 capture 结果修正文档与 adapter。

`tournamentdraft` 不作为 telemetry core 的必需输入。BP 的 canonical owner 仍然是 RivalHub；Broadcast 只消费 canonical BP 做 presentation playback。

### 12.2 Update rate

M1 Design Baseline 不冻结 production `buffer` / `throttle` 数值。

第一份 reference capture 应偏向高保真、低 buffer / 低 throttle，以测量：

- 实际 update cadence；
- no-op / sparse frame 比例；
- payload size；
- CPU / GC；
- recorder throughput；
- radar / HUD 所需有效更新频率。

正式 production profile 应在获得真实 capture 后单独确定。

禁止在 runtime core 中硬编码某个 GSI Hz 假设。

---

## 13. Real GSI Reference Capture Pack

### 13.1 Platform gate

真实 GSI corpus 必须来自：

```text
Windows
+ current CS2 build
+ spectator / observer context
+ project GSI config
```

GitHub-hosted Windows CI 不能替代该验证。

### 13.2 Required scenarios

第一批 reference corpus 至少覆盖：

```text
normal round
kill / damage
bomb plant / defuse / explode
grenade / smoke / molotov / inferno
warmup
freezetime
live
round over
halftime / side switch
map end / map change
disconnect / reconnect
restart（可行时）
```

### 13.3 Evidence to validate

真实 capture 用于验证：

- 当前 CS2 payload shape；
- top-level / nested partial update 行为；
- collection replacement / deletion 行为；
- spectator-only field 可用性；
- `provider.timestamp` 行为；
- 当前 enum/value corpus；
- update cadence；
- payload size / volume；
- reconnect / restart / map-change 边界序列；
- recorder throughput 与 drop behavior。

如果真实 evidence 与本文 implementation hypothesis 冲突，应优先修正文档、fixture 与 adapter。

---

## 14. Initial package graph

M1 第一批真实 dependency 预计为：

```text
packages/core
  ↑
packages/telemetry-gsi
  ↑
apps/companion

packages/core + packages/telemetry-gsi
  ↑
packages/testkit
```

具体职责：

```text
core
  normalized telemetry contract

telemetry-gsi → core
  CS2 GSI adapter

companion → telemetry-gsi + core
  HTTP ingress + production recorder + composition

testkit → telemetry-gsi + core
  replay + simulator + fault injection
```

约束：

- `apps/web` 不依赖 Raw GSI；
- `packages/protocol` 不因 M1 telemetry 实现被提前引入；
- production owner 不 runtime-depend on `packages/testkit`；
- 不通过 TS `paths` 或跨 package `src` import 绕过 workspace dependency。

---

## 15. Workspace build graph requirement

M0 阶段 shared package 尚未存在真实 runtime workspace dependency，因此 clean-tree 跨 package build 尚未得到实际验证。

第一张引入：

```text
telemetry-gsi → core
```

的 M1 implementation PR 必须证明：

```text
fresh clone / clean dist
pnpm install --frozen-lockfile
pnpm architecture:check
pnpm typecheck
pnpm test
pnpm build
```

在真实 workspace dependency 存在时稳定通过。

如果现有独立 `tsc` + `dist` exports 无法满足 clean-tree typecheck/build，应在该实现中根据 TypeScript 当前行为建立最小、明确的 project/build graph。

禁止使用以下方式绕过：

```text
compilerOptions.paths
../../other-package/src
package src export
```

Build graph 的具体实现不在本文提前指定，以第一条真实 dependency 的 implementation evidence 为准。

---

## 16. Initial M1 execution decomposition

以下为当前建议的工作切分，不代表 Issue 已创建或字段已经最终冻结。

### 16.1 Telemetry Contract & Adapter Foundation

范围：

- Core-owned telemetry contract；
- Raw GSI parser / validator；
- GSI source-state reconstruction；
- normalization；
- synthetic fixtures；
- first real workspace edge / build graph validation。

### 16.2 GSI Ingress & Production Capture Recorder

范围：

- Companion `/gsi` ingress；
- token / limits；
- receive clocks；
- bounded recorder；
- capture format；
- sanitizer contract；
- recorder health / diagnostics。

### 16.3 Replay / Fixture Runtime

范围：

- capture reader；
- ReplayClock；
- step / 1x / Nx；
- production adapter replay；
- selected HTTP ingress replay。

### 16.4 Real CS2 Reference Capture Pack

范围：

- Windows + CS2 spectator real-environment validation；
- reference corpus；
- partial/update/cadence verification；
- adapter/spec correction based on evidence。

### 16.5 Runtime Skeleton & Debug Projection

在 replay/capture foundation 稳定后进入：

- producer instance/time primitives；
- session / map epoch skeleton；
- RuntimeState reducer；
- first RuntimeTransition；
- basic latest-wins in-process delivery；
- Debug projection。

建议依赖关系：

```text
Telemetry Contract / Adapter
          ↓
Ingress / Recorder ──► Real Capture
          ↓                │
Replay Runtime ◄───────────┘
          ↓
Runtime Skeleton
```

---

## 17. Validation model

M1 telemetry work继续遵守 `docs/development-validation.md`。

### Layer A — deterministic

应在 macOS / Linux / Windows CI 中覆盖：

- raw parser；
- merge semantics；
- normalization；
- unknown/unavailable handling；
- capture reader/writer semantics；
- ReplayClock；
- deterministic replay；
- sanitizer；
- clean-tree workspace build graph。

### Layer B — local runtime

主要覆盖：

- Fastify GSI endpoint；
- auth / body limits；
- recorder integration；
- local diagnostics；
- HTTP ingress replay。

### Layer C — real CS2

必须补充：

- real payload；
- spectator-only behavior；
- update cadence；
- partial collection behavior；
- restart / reconnect / map change；
- production candidate GSI cfg。

M1 的纯 adapter 实现可以在 Layer C evidence 前进入 PR，但任何声称“已验证当前真实 CS2 行为”的结论必须有真实 capture 支持。

---

## 18. Frozen decisions

当前已经冻结：

- Raw GSI 不泄漏到 Core / Web / RivalHub adapter；
- Core 拥有 normalized telemetry input contract；
- `telemetry-gsi` 负责 raw parsing、source reconstruction 与 normalization；
- RuntimeTransition 由 Core 推导，不由 GSI library 决定；
- unknown / unavailable 不伪装成 zero / false / empty；
- parser 必须容忍未来新增 enum/string value；
- duration / pacing 使用 monotonic clock；
- UTC wall clock 用于时间点与 evidence；
- production capture 保存 sanitized accepted raw GSI；
- production recorder 属于 Companion runtime，而不是 testkit；
- replay 必须复用 production telemetry adapter；
- recorder queue 必须 bounded；
- recorder failure 不得拖死 live telemetry runtime；
- production GSI update rate 暂不冻结；
- 第一条真实 workspace dependency 必须验证 clean-tree typecheck/build。

---

## 19. Open validation questions

以下内容必须在真实 Windows + CS2 spectator capture 后重新确认：

- 当前 CS2 每个 block 的精确 partial update 行为；
- nested collection 的 replacement / deletion corner case；
- spectator-only fields 的实际 shape；
- 当前真实 update cadence；
- `provider.timestamp` 精度与行为；
- 当前 enum/value corpus；
- map restart / reconnect / halftime / side switch / map change 的真实序列；
- payload volume；
- recorder throughput；
- 推荐 production `buffer` / `throttle`；
- gold/reference corpus 的最小覆盖集合。

这些问题在获得真实 evidence 前，不应通过单元测试中的 synthetic fixture 自行“证明”。

---

## 20. References and authority

本文设计以以下仓库内 authority 为上位约束：

- ADR-0001：项目定位与 canonical authority；
- ADR-0002：Runtime / Workspace 技术基线；
- ADR-0003：RuntimeState、identity、time、delivery / backpressure invariant；
- `docs/architecture.md`：整体 package ownership 与 plane boundary；
- `docs/development-validation.md`：macOS / CI / Windows + CS2 + OBS 验证模型。

外部 GSI 文档、Eon 等 HUD 实现及现代 CS2 GSI library 仅用于确认 source behavior、工程风险与已有经验，不成为 RivalHub Broadcast domain contract 的 owner。
