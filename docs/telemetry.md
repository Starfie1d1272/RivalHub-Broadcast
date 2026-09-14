# Telemetry / GSI 设计基线

> 状态：**M1 Design Baseline + real-capture evidence**。
>
> 本文定义 RivalHub Broadcast 在 M1 阶段的 Telemetry / CS2 Game State Integration（GSI）边界、数据语义、capture/replay 约束与真实环境验证要求。本文服从 ADR-0001～0003 中已经接受的 authority、RuntimeState、identity、time 与 delivery invariant。
>
> 2026-09 已获得一份 RoundSense normal-player capture 与两份 RivalHub Broadcast Windows observer capture。本文已经把能够被真实数据确认的 source semantics 从“implementation hypothesis”收敛为 evidence-backed baseline；仍未被真实场景覆盖的行为继续明确标记为 open validation question。

## 1. 目标与范围

M1 Telemetry 层负责建立以下稳定链路：

```text
CS2 Raw GSI frame
    ↓
Companion GSI ingress
    ↓
block-specific source interpretation
    ↓
Normalized Telemetry
    ↓
Broadcast Core
```

目标是将 CS2 提供的 source-specific、可能随版本与 observer context 变化的 GSI 输入，转换为 Core 可以稳定消费的 telemetry observation，同时保留完整的可验证性与可重放性。

本阶段重点解决：

- Raw GSI 接收与 source ownership；
- block-specific current-observation semantics；
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
interpret block-specific source semantics
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

> 当前 telemetry source 在当前 frame 中能够提供的、完成 source interpretation 与 normalization 的观测。

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

生产输入与 replay 输入必须复用同一条 telemetry adapter 路径，以便 parser、block semantics、normalization 与兼容性逻辑能够被真实 corpus 持续验证。

### 2.5 真实 evidence 优先于 synthetic fixture

Synthetic fixture 用于覆盖预期 shape、错误输入与边界条件，但不得自行“证明”真实 CS2 source behavior。

当真实 Windows + CS2 capture 与旧 hypothesis、第三方库行为或 synthetic fixture 冲突时，应优先：

1. 保留原始 capture 作为 evidence；
2. 修正文档中的 source hypothesis；
3. 更新 adapter 与 derived fixture；
4. 不通过兼容层伪造旧假设继续成立。

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
 │                 sanitized accepted raw frame
 │                 + capture timing metadata
 │
 ▼
packages/telemetry-gsi
 │
 │ tolerant raw parsing
 │ block-specific source interpretation
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
├─ receive
│  ├─ sequence
│  ├─ receivedAt
│  └─ receivedMonotonicMs
├─ source
│  ├─ kind
│  └─ providerTimestamp?
├─ coverage
├─ telemetry
│  ├─ map
│  ├─ round
│  ├─ phaseCountdowns
│  ├─ player
│  ├─ allPlayers
│  ├─ bomb
│  └─ grenades
```

`coverage` 只表达当前 frame 对各 source block 的观测状态（`present / absent / degraded`），不等于 ADR-0003 中由连续性、连接健康和 identity 派生的 runtime capability。

GSI-specific diagnostics 不属于 Core-owned `TelemetryObservation`。Adapter 的结果在 contract 上保持并列：

```text
GsiAdaptResult
├─ observation: TelemetryObservation
└─ diagnostics: GsiDiagnosticBatch
```

以上是语义结构；最终 TypeScript schema 由 #10 实现冻结。Core contract 不出现 Raw GSI 字段、`previously` / `added` 或 GSI diagnostic code。

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
- block-specific source semantics；
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

## 6. Raw GSI source semantics

### 6.1 不采用 universal retain-on-omit merge

最初的设计假设曾将 CS2 GSI 统一理解为 partial patch，并计划维护一个通过 deep/recursive merge 得到的 `GsiSourceState`：

```text
field absent
→ retain previous value
```

真实 capture 已证明该规则不能作为全局 source semantics。

在 normal-player capture 中，`round.bomb`、`round.win_team` 等字段会在下一阶段从 current payload 中消失；如果一律沿用旧值，会制造“新回合仍然 exploded / 保留上回合 winner”的 stale ghost state。

因此 M1 禁止实现通用：

```text
deepMerge(previousSourceState, currentPayload)
```

并把结果视为“当前真实 GSI state”。

每个 accepted payload 首先被视为一次**当前 source observation**。是否需要跨 frame continuity，只能按具体 block、具体 capability 与已验证 evidence 决定。

### 6.2 当前 evidence 支持的 block 行为

在已录制场景中，以下 block 表现为 current snapshot / current collection：

```text
map
round
player
allplayers
phase_countdowns
bomb
grenades   # cfg component 名为 allgrenades，payload root key 实际为 grenades
```

其中 observer capture 对 `allplayers` 的证据尤其强：

- Demo capture：150 个 `allplayers` frame，每帧恰好 10 名玩家；
- BOT spectator capture：1936 个 `allplayers` frame，每帧恰好 10 名玩家；
- 两份 capture 中，每个 player object 均持续包含 `name / team / observer_slot / state / weapons / match_stats / position / forward`。

在这些已观测场景中，不需要通过上一帧 merge 才能得到完整 10-player observation。

这不等于声明“未来所有版本、所有上下文永远是完整 10 人 snapshot”。Adapter 仍应 tolerant，并对违反已知 shape 的情况输出 diagnostic，而不是崩溃或伪造字段。

### 6.3 Missing 的语义必须按 block/context 解释

禁止建立：

```text
block absent == unchanged
```

这样的全局等价关系。

已观察到：

- `round` 在 warmup 场景可以完全不存在；
- root `bomb` 在 BOT capture 的 warmup 阶段不存在，正式回合开始后持续出现；
- normal-player `round.bomb / round.win_team` 在其语义结束后从 current block 消失；
- observer-only capability 是否可用取决于 cfg 与 observer context。

因此 absence 可能表示：

```text
当前语义不存在
当前 context 不提供该 capability
当前 block 未被 source 提供
source/context transition
```

只有在对特定 block 有额外真实证据时，adapter 才能定义 retain-on-omit 行为；该规则必须局部、可测试、可诊断，不能成为默认 merge policy。

### 6.4 `previously` / `added` 是 change hint，不是 domain truth

Raw capture 保留：

```text
previously
added
```

真实 normal-player capture 中，`previously` 大部分时候准确给出上一状态的旧值，`added` 也能标识新出现路径；observer captures 中两者同样频繁出现。

但 RoundSense capture 也出现了 current state 明显变化、而该 frame 没有完整 `previously` 提示的情况。

因此它们只能用于：

- source diagnostics；
- compatibility investigation；
- current-vs-previous diff 的交叉验证；
- corpus analysis；
- parser regression evidence。

它们不得：

- 直接进入 Core telemetry contract；
- 成为检测变化的唯一条件；
- 直接映射为 RuntimeTransition；
- 成为 canonical result evidence 的唯一来源。

生产 transition 仍应由：

```text
previous normalized observation
+ current normalized observation
+ Core RuntimeState
```

确定性推导。

### 6.5 GSI cfg component 名与 payload shape 不要求一一同名

真实 observer capture 已确认至少两个容易误判的例子：

```text
cfg: allgrenades
payload root: grenades

cfg: allplayers_position
payload: allplayers[steamid].position / forward
```

因此 parser/schema 必须以**真实 payload**为准，而不是通过 cfg component 名机械推导 JSON key。

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
- 当前 `grenades` block 明确存在且为空，才可以表示当前 collection empty；
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

应记录 **accepted raw GSI input**，而不是只记录 normalized output，以保证 parser、block semantics、normalization 未来发生变化后仍可对原始现实输入重新验证。

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

原始 capture 默认保持 repo-local / external evidence，不因“需要 replay”直接提交真实身份数据。

### 10.4 Recorder backpressure

Recorder 不能通过无限内存队列保证“绝不丢 frame”。

Production recorder 要求：

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

验证用 spike recorder 可以选择更简单的同步持久化，但不得被未经评估地复制为 production hot path。

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

真实 observer capture 已使用以下字段集合：

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

实际 JSON 中已确认：

- `allplayers_position` 以每名 player 的 `position / forward` 表达；
- `allgrenades` 订阅对应的 payload root key 是 `grenades`。

`tournamentdraft` 不作为 telemetry core 的必需输入。BP 的 canonical owner 仍然是 RivalHub；Broadcast 只消费 canonical BP 做 presentation playback。

### 12.2 Update rate

首轮 observer captures 使用：

```text
buffer = 0.1 s
throttle = 0.1 s
heartbeat = 60 s
```

BOT spectator capture 的 payload interval：

```text
median ≈ 249 ms
p95 ≈ 257 ms
```

即该环境下实际可见 cadence 约为 4 Hz，而不是配置上限对应的 10 Hz。

Demo capture 的典型 interval 同样约 250 ms，但由于播放中断/暂停存在长间隔，因此不用于 p95 production sizing。

结论：

- runtime core 禁止硬编码固定 GSI Hz；
- Radar / animation 必须预期 source snapshot 频率明显低于浏览器渲染频率，并通过 interpolation/presentation scheduling 平滑；
- production `buffer` / `throttle` 仍不在本 PR 冻结，后续用真实比赛形态与性能数据决定。

---

## 13. Real GSI evidence corpus

### 13.1 已获得的 capture

原始 capture 因包含真实 Steam identity / display name，不直接提交到仓库。文档记录 provenance 与能够复核的摘要；后续进入 Git 的 fixture 必须由原始 evidence deterministic sanitization 派生。

#### A. RoundSense normal-player capture

```text
source: cs2-roundsense historical runtime capture
CS2 provider version: 14174
frames: 102
file SHA-256:
beb711e09b4a9fcb7dca9c1b44cfd1699cecf7ed4a101a74ae69d995529646cb
```

主要确认：

- normal-player `map / round / player` current-state behavior；
- `previously / added` 是有价值但不完备的 change hint；
- `round.bomb / round.win_team` 等字段会在后续阶段消失，因此 universal retain-on-omit 会制造 stale state；
- heartbeat frame 可以在没有 domain state change 时出现；
- record → replay 思路可行。

#### B. RivalHub Broadcast Demo observer capture

```text
captureId: 20260913T161643Z-56b6492b
platform: Windows 11 Pro for Workstations
CS2 provider version: 14181
frames: 157
frames SHA-256:
519cec4f94f93b2cbc3b34d5e32d60e428039a94b3999d058a56910afcd7c5f9
```

Operator note：旧比赛 Demo 在 warmup 结束附近出现 client-side message parse / playback failure，因此 capture 未进入正式 live round。本文不从该 capture 单独推断失败根因。

即使如此，该 capture 已确认：

- `allplayers` 出现 150 帧；
- 每个 `allplayers` frame 都是 10 人，且为 5 CT + 5 T；
- 共 1500 个 player object，全部包含 `name / team / observer_slot / state / weapons / match_stats / position / forward`；
- `phase_countdowns` 可用；
- payload root `grenades` 出现 150 帧，其中 50 帧非空；
- 实际观察到 `frag / firebomb / inferno`，以及 position / velocity / owner / lifetime；inferno 可带 `flames`；
- root `bomb` 未出现，与本 capture 未进入正式回合一致。

#### C. RivalHub Broadcast local BOT spectator capture

```text
captureId: 20260913T162802Z-3f41d8df
platform: Windows 11 Pro for Workstations
CS2 provider version: 14181
frames: 1940
frames SHA-256:
e34505e2626dfa6f0941b8b4ed675dbea38e2ff53e29e3240c36ad7a2673d218
```

重要 provenance caveat：capture spike 的 `scenario` 字段当时仍硬编码为 `demo-observer`；根据操作者记录，本次实际场景是**本地 BOT 对局 spectator**。因此 raw manifest 的 scenario metadata 不应被静默当成真实场景标签。

该 capture 已确认：

- `allplayers` 出现 1936 帧，每帧仍为 10 人；
- warmup 初期存在 5 CT + 5 T，正式对局阶段因本地 BOT/队伍切换变为 6 CT + 4 T；
- 共 19360 个 player object，全部包含 `name / team / observer_slot / state / weapons / match_stats / position / forward`；
- `round.phase` 覆盖 `freezetime / live / over`；
- `phase_countdowns.phase` 覆盖 `warmup / freezetime / live / bomb / defuse / over`；
- root `bomb.state` 实际覆盖：

```text
carried
dropped
planting
planted
defusing
exploded
```

- `round.bomb` 观察到 `planted / exploded`；
- `round.win_team` 观察到 `CT / T`；
- 在 `buffer=0.1 / throttle=0.1` 下，稳定 live 数据典型 cadence 约 4 Hz。

本地 6v4 队伍分布影响比赛真实性，但不影响本次对 GSI block shape、10-player collection、position、phase 与 bomb lifecycle 的 source-level验证。

### 13.1.1 Fixture evidence levels

`#10` 的测试只提交少量可追溯 excerpt，不提交完整 capture，也不在 adapter 中建设 capture reader 或 sanitizer：

- `packages/telemetry-gsi/test/fixtures/real-derived.ts` 是从 A 的完整文件确定性脱敏得到的单帧 excerpt：`seq=2..2`，保留 source provider timestamp 与 source fields，Steam identity 和 display name 映射为 fixture 值；
- `packages/telemetry-gsi/test/fixtures/real-derived-observer.ts` 包含 B 的 `seq=45..45` observer block excerpt，以及 C 的 `seq=567,580,661,746,775` bomb lifecycle block excerpts 和 `seq=761` observer transition excerpt；均保留真实 raw numeric/string/vector-string shape（包括 decimal-string timers、grenade lifetime 与 flame vector map），并只对 identity/display name 做确定性映射或省略无关 block；
- `packages/telemetry-gsi/test/fixtures/synthetic-evidence-informed.ts` 是根据 C 已记录的 source facts 组成的 synthetic fixture。它带有 capture id 和完整 frames hash 作为 evidence reference，但没有单一 source frame/index/range，因此不能被解释为真实字段共现证据。

B/C 两个完整 ZIP 仍属于 #11 的 capture consumption、sanitization、replay 与 gold-fixture 输入；#10 只提交上述 block-level excerpts，不提交完整 corpus。

### 13.2 已经可以冻结的 source facts

当前 evidence 足以冻结：

- 不允许 universal retain-on-omit deep merge；
- 每个 frame 首先作为 current source observation 处理；
- `allplayers` 在已观察 spectator 场景中是完整 10-player current collection；
- `position / forward` 位于每个 `allplayers` player object 内；
- cfg `allgrenades` 对应 payload root `grenades`；
- root `bomb`、`round.bomb`、`phase_countdowns` 是不同 source concept，不应合并成一个原始字段；
- `previously / added` 只作为 hints/diagnostics；
- domain transitions 仍由 normalized observation + Core state 推导；
- source cadence 与 render cadence 分离。

### 13.3 仍未覆盖的真实场景

首轮 corpus 还没有完整覆盖：

```text
halftime / side switch
map end / map change
disconnect / reconnect
CS2 restart / server restart
player join / leave collection edge cases
长时 wall-clock soak
正式赛事 GOTV / production observer path
```

因此这些边界不得通过当前 3 份 capture 过度外推。

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
  CS2 GSI parser + block-specific adapter

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
- tolerant Raw GSI parser / validator；
- block-specific source semantics；
- normalization；
- adapter statelessness/determinism boundary；current-vs-previous comparison belongs to downstream Core/runtime；
- synthetic fixtures；
- 从真实 captures 派生的 sanitized regression fixtures；
- first real workspace edge / build graph validation。

明确不实现 universal `GsiSourceState` deep merge accumulator。

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
- selected HTTP ingress replay；
- semantic checkpoints / expected observations for gold replays。

### 16.4 Real CS2 Reference Corpus Hardening

第一批 observer capture 已完成，因此该工作不再是 M1 开工前置条件。

后续范围：

- deterministic sanitization；
- representative gold fixture selection；
- halftime / reconnect / map-change 等未覆盖 scenario；
- 正式赛事形态 validation；
- adapter/spec correction based on new evidence。

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
Ingress / Recorder ──► additional Real Captures
          ↓                │
Replay Runtime ◄───────────┘
          ↓
Runtime Skeleton
```

---

## 17. Validation model

M1 telemetry work 继续遵守 `docs/development-validation.md`。

### Layer A — deterministic

应在 macOS / Linux / Windows CI 中覆盖：

- raw parser；
- block-specific source semantics；
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

当前已有第一批 Windows + CS2 evidence，但仍需继续覆盖：

- halftime / side switch；
- disconnect / reconnect；
- map end / map change；
- restart；
- production candidate GSI cfg；
- 正式赛事 observer/GOTV 形态。

### Layer D — production acceptance

仍按 `docs/development-validation.md` 要求，在真实赛事形态完成 Windows + CS2 spectator + OBS 长时验收。

CI 绿灯与当前短时 capture 都不能替代 Layer D。

---

## 18. Frozen decisions

当前已经冻结：

- Raw GSI 不泄漏到 Core / Web / RivalHub adapter；
- Core 拥有 normalized telemetry input contract；
- `telemetry-gsi` 负责 raw parsing、block-specific source interpretation 与 normalization；
- **禁止 universal retain-on-omit / deep-merge source reconstruction**；
- 每个 accepted GSI frame 首先被视为 current source observation；
- 只有对具体 block 有 evidence 时才允许跨 frame continuity policy；
- `previously / added` 是 non-authoritative change hints；
- RuntimeTransition 由 Core 推导，不由 GSI library 决定；
- observer `allplayers` 在当前真实 corpus 中表现为完整 10-player collection；
- cfg `allgrenades` 的实际 payload root 为 `grenades`；
- root `bomb` / `round.bomb` / `phase_countdowns` 保持 source concept 分离；
- unknown / unavailable 不伪装成 zero / false / empty；
- parser 必须容忍未来新增 enum/string value；
- duration / pacing 使用 monotonic clock；
- UTC wall clock 用于时间点与 evidence；
- production capture 保存 sanitized accepted raw GSI；
- production recorder 属于 Companion runtime，而不是 testkit；
- replay 必须复用 production telemetry adapter；
- recorder queue 必须 bounded；
- recorder failure 不得拖死 live telemetry runtime；
- GSI source cadence 与 renderer cadence 分离，Radar/visual motion 需要 interpolation；
- production GSI `buffer` / `throttle` 暂不冻结；
- 第一条真实 workspace dependency 必须验证 clean-tree typecheck/build。

---

## 19. Open validation questions

真实 capture 已经关闭“observer-only payload 是否可获得”“allplayers 基本 shape”“bomb/phase/grenade 基本 shape”“典型 cadence”这些早期问题。

仍需后续真实 evidence 确认：

- 各 block 在 disconnect / reconnect / restart / map change 时的 absence 与恢复语义；
- nested collection 的 replacement / deletion corner case；
- player join / leave、非 10-player 场景及异常 roster 下的 collection 行为；
- halftime / side switch / map end 的真实 frame sequence；
- `provider.timestamp` 精度与跨 restart 行为；
- 长时 payload volume / recorder throughput / disk sizing；
- production recorder 的实际 drop/backpressure behavior；
- 推荐 production `buffer` / `throttle`；
- gold/reference corpus 的最小覆盖集合；
- 正式赛事 GOTV / observer path 与 Demo / local spectator 是否存在 source-shape 差异。

这些问题在获得对应真实 evidence 前，不应通过 synthetic fixture 自行“证明”。

---

## 20. References and authority

本文设计以以下仓库内 authority 为上位约束：

- ADR-0001：项目定位与 canonical authority；
- ADR-0002：Runtime / Workspace 技术基线；
- ADR-0003：RuntimeState、identity、time、delivery / backpressure invariant；
- `docs/architecture.md`：整体 package ownership 与 plane boundary；
- `docs/development-validation.md`：macOS / CI / Windows + CS2 + OBS 验证模型。

内部 empirical evidence：

- `cs2-roundsense` Windows build 14174 normal-player capture；
- RivalHub Broadcast `20260913T161643Z-56b6492b` Demo observer capture；
- RivalHub Broadcast `20260913T162802Z-3f41d8df` local BOT spectator capture。

原始 capture 不进入仓库 authority；它们是 source behavior 的 evidence。进入 Git 的长期 test asset 必须是可追溯到原始 hash 的 deterministic sanitized derivative。

外部 GSI 文档、HUD 实现及现代 CS2 GSI library 仅用于确认 source behavior、工程风险与已有经验，不成为 RivalHub Broadcast domain contract 的 owner。
