# Telemetry 数据语义

本文定义 CS2 GSI 与 CSTV 输入在 Broadcast 中的 ownership、source semantics、normalization 和 evidence 要求。它不描述某个实施阶段，只记录当前有效规则与仍有长期价值的真实 source facts。

## 1. 数据流

### GSI

```text
CS2 Raw GSI
    ↓
Companion HTTP ingress
    ├─→ bounded Capture Recorder
    └─→ packages/telemetry-gsi
            ↓
      TelemetryObservation
            ↓
        packages/core
```

### CSTV

```text
CSTV / playcast
    ↓
packages/telemetry-cstv
  third-party parser binding
    ↓
      GameEventObservation (role-scoped)
    ↓
Core / source manager / ProgramCue or Lookahead alignment
```

Raw GSI 和第三方 parser object 都必须在各自 adapter 边界内终止。

## 2. GSI observation 不是 patch

每个通过认证的 GSI payload 首先被解释为**当前 source observation**。

禁止全局规则：

```text
field absent
→ retain previous value
```

也禁止把：

```text
deepMerge(previous, current)
```

当成“当前真实 GSI state”。

真实 CS2 payload 会让某些只在特定阶段存在的字段自然消失。如果一律保留旧值，会制造上一回合 `winner`、`bomb` 等 ghost state。

## 3. Block-specific semantics

当前 adapter 按 block 独立表达 coverage：

```text
present
absent
degraded
```

主要 block：

```text
map
round
phase_countdowns
player
allplayers
bomb
grenades
```

Absence 可能表示：

- 当前语义不存在；
- 当前 observer context 不提供该 capability；
- source 暂时没有提供该 block；
- source/context 正在转换。

因此 `absent` 不等于 `unchanged`。

对特定 block 如果需要跨帧 continuity，必须有明确真实 evidence、局部实现和可测试 diagnostic，不能扩张成通用 merge policy。

### 3.1 已验证的 source facts

仓库现有真实 capture 已经足以证明以下规则，后续实现不应重新退回 universal retain-on-omit：

- 一份完整 Demo observer capture 中，`allplayers` 出现的 150 个 frame 每帧均包含 10 名玩家；
- 一份 BOT spectator capture 中，`allplayers` 出现的 1936 个 frame 每帧均包含 10 名玩家；
- 这些已观测 frame 中，每个 player object 持续提供 `name / team / observer_slot / state / weapons / match_stats / position / forward`；
- `round` 在 warmup 场景可以整体不存在；
- root `bomb` 在已观测 BOT warmup 中不存在，正式回合开始后才持续出现；
- normal-player capture 中，`round.bomb` 与 `round.win_team` 会在对应语义结束后从 current payload 消失；
- `previously` / `added` 通常提供有价值的 change hint，但真实 capture 也存在 current state 已变化而 hint 不完整的 frame。

### 3.2 地图 canonicalization 与 `map_round_wins`

Core 与 Radar 共用 Broadcast-owned 的显式 CS2 地图别名表，例如 `Mirage / mirage / de_mirage` 归一为 `de_mirage`，`Dust 2 / dust2 / Dust II / de_dust2` 归一为 `de_dust2`。只允许明确别名和空白/大小写规范化，不使用编辑距离或模糊猜测。

`map.round_wins` 在 `packages/telemetry-gsi` 中解析为 normalized `ObservedRoundWin[]`。已知 `ct_win_* / t_win_*` 原因映射为 `elimination`、`bomb`、`defuse`、`time`；未知原因保留 `winnerSide = unknown` 与 `winCondition = unknown`，并产生 adapter diagnostic。

它不是独立实时状态机：连续运行时由 `round_ended` transition 冻结 Round History，`map_round_wins` 只用于中途加入、重连/进程恢复和同一回合的安全校验/原因补充。只有能够证明 key 是当前地图的绝对连续回合号时才恢复缺失历史；加时可能重置局部 key 时标记 `partial`，不猜 OT offset。Core 对每张地图的历史保留显式上限，避免 source payload 或恢复路径造成无界增长。

这些事实只证明**已录制场景**中的 source behavior，不声明所有 CS2 版本和 observer context 永远保持完全相同。Adapter 仍需 tolerant，并在实际 shape 偏离已知 evidence 时输出 diagnostic，而不是崩溃或伪造缺失字段。

## 4. `previously` / `added`

Raw GSI 中的 `previously` 与 `added` 只作为 change hint 和 diagnostic evidence：

- parser compatibility 调查；
- current-vs-previous diff 交叉验证；
- corpus 分析；
- regression test。

它们不是 Broadcast domain truth，也不能直接生成 `RuntimeTransition`。

## 5. TelemetryObservation

`TelemetryObservation` 是 Core-owned input contract，表达某一 source frame 经解释后的 current observation。

概念结构：

```text
TelemetryObservation
├─ receive
│  ├─ sequence
│  ├─ receivedAt
│  └─ receivedMonotonicMs
├─ source
├─ coverage
└─ telemetry
   ├─ map
   │  └─ roundWins（map_round_wins 的 normalized recovery evidence）
   ├─ round
   ├─ phaseCountdowns
   ├─ player
   ├─ allPlayers
   ├─ bomb
   └─ grenades
```

它不包含：

- canonical RivalHub identity；
- official lifecycle / result；
- scene state；
- operator override；
- accumulator output；
- Lookahead future cue。

GSI-specific diagnostics 与 `TelemetryObservation` 并列返回，不塞进 Core domain。

### 5.1 Objective Clock 与 overloaded bomb countdown

Raw GSI 的 root `bomb.countdown` 是 state-dependent observation，不是一个跨状态同义的永久
时钟：

| `bomb.state`                       | `bomb.countdown` 语义                                  |
| ---------------------------------- | ------------------------------------------------------ |
| `carried` / `dropped`              | 没有 objective action clock                            |
| `planting`                         | 当前 plant action remaining                            |
| `planted`                          | C4 explosion remaining                                 |
| `defusing`                         | 当前 defuse action remaining，不是 explosion remaining |
| `defused` / `exploded` / `unknown` | terminal 或不可用                                      |

`phase_countdowns` 只表达当前 phase clock。它可以与 bomb state 做同语义交叉验证，但不能
在 defusing 时被当作 explosion fallback。

Core 在 `RuntimeState.objectiveTiming` 内维护一个不进入 wire 的 anchor：

```text
{ remainingSecondsAtSample, sampledAtMonotonicMs,
  source: "bomb-planted-countdown" }
```

只有 `coverage.bomb = present`、当前 round 不是 `over` 且 `state = planted` 携带 finite
countdown 时才建立或重新校准 anchor。planted countdown 暂缺时保留既有 anchor；defusing
保留 anchor 且不使用 defuse countdown 覆盖它；没有 anchor 的首次 defusing 保持 explosion
为 `null`，不合成 40 秒。carried、dropped、planting、terminal、unknown、bomb absent 或
degraded、map epoch 变化和 Program source generation 变化都会清除/失效 objective timing。

plant/defuse action 由当前 observation 即时派生。actor 缺失不清除 action time；defuse kit
只从当前 matching player 的 `hasDefuser` evidence 读取，未知就是 `null`，不做 heuristic。
所有 duration / interpolation / lease 使用 monotonic clock；UTC 只用于 capture、报告和审计。
短 objective-clock lease 的 canonical policy 在
`packages/core/src/runtime/objective-timing-policy.json`；当前默认值为 1000 ms、上限为
2000 ms。它独立于全局 `staleAfterMs = 20000`。
lease 过期时 Program 保留当前 bomb semantic state，但 numeric remaining fail closed 为
`null`。浏览器 reconnect 只重新取得 baseline，Core 才负责 anchor continuation。

Raw `bomb.countdown` 仍只存在于 telemetry adapter / capture 边界。它不能穿透为 Program
顶层 `bomb.countdownSeconds`，也不能由 React state retention 补回。

### 5.2 Active lineup 与 map-scoped player stats

`telemetry.allPlayers` 是当前 source observation，不是已经筛选好的正式节目名单。Core 在 identity 与 continuity 之后派生两个独立结果：

```text
allPlayers observation
  ├─ ActiveLineupResolution → Program Player Rails 的稳定 5+5 cohort
  └─ MapPlayerStatsAccumulator → map-scoped ADR
```

Active lineup 只在 `coverage.allPlayers = present`、10 个唯一稳定 Steam64、CT 5 人 + T 5 人且无歧义时建立或替换 baseline。observer、coach、spectator 和 transient extra 不进入 cohort；稳定 baseline 遇到单帧缺失、extra 或 `degraded` evidence 时保留原 logical participants，并以 `lineupEvidence: retained` 与 `degraded` 表达证据质量。没有 previous baseline 时，degraded 的 clean-looking 5+5 仍不得晋升。`coverage.allPlayers = absent` 不触发 lineup transition。Stable Steam64 membership 与 CT/T side assignment 分离，halftime / overtime 换边只更新 side。same-map source generation 变化时，retained membership 使用当前 generation 的 resolution cursor，但不复用旧 entry 的 volatile telemetry。连接模式的 MatchRoster / gameplay identity 用于排序、消歧和 canonical mapping，不作为未知 Steam64 active player 的硬 allowlist。

`retained` 只表示节目 membership 仍然成立，不表示 source 仍提供该 entry 的当前状态。缺失成员的 health、equipment、weapons、observer slot 等 volatile telemetry 必须保持 unavailable/null；Raw source observation 不能为了填满 HUD card 而回写上一帧数值。

ADR 只使用 Steam64 keyed player state 的 `roundTotalDamage`，每个 counted round 保存该字段的最大值，避免死亡后 source 把累计值回报为零。round phase transition、continuity 和 `mapEpoch` 驱动生命周期；`map.round` 只作 sanity hint，因此 `freezetime/live round=N → over round=N+1` 仍可 finalize 当前有效回合。完整观察到 freezetime → live 的回合才进入 counted rounds；当前 counted round 任意时刻出现 `coverage.allPlayers != present` 时立即 `invalidated=true`、`eligible=false`，不对有洞的回合插值；已完成历史保留，后续新的完整回合可以重新开始统计。`liveAdr` 包含当前 eligible round，`completedAdr` 只包含已完成 counted rounds；`mapEpoch` 改变才清空 map-level history。

这些都是 Core 派生语义。Renderer 不负责 roster inference、identity binding 或 ADR history；Raw GSI `previously` / `added` 仍只作为 adapter diagnostics 和 regression evidence。

## 6. GSI ingress

Companion 的 GSI ingress 只负责：

1. 接收 HTTP POST；
2. 验证 GSI token；
3. 应用 body / request limit；
4. 记录 UTC 与 monotonic 接收时间；
5. 将 accepted payload 交给 Capture Recorder 和 telemetry adapter；
6. 快速 ACK。

request hot path 不执行磁盘等待、RivalHub 网络调用、场景选择或重型业务逻辑。

默认监听 loopback。LAN exposure 不是 telemetry 默认行为。

## 7. Capture

Production Capture Recorder 属于 Companion telemetry runtime，不属于 `packages/testkit`。

基本要求：

- 写盘与 GSI request ACK 解耦；
- queue 有明确 item 和 byte 上限；
- queue overflow 时记录 degraded state，不无限积压；
- writer failure 不阻塞 Runtime；
- shutdown 尝试 bounded finalization 并明确 incomplete 状态；
- token 和不必要个人数据不进入可共享 fixture。

Capture format 必须保留足够的 receive time、sequence 和 integrity information，使 offline verifier 能证明某个 runtime observation 对应真实 accepted frame。

## 8. Replay

Replay 必须重新经过 production adapter：

```text
recorded raw input
→ production parser / normalizer
→ Core
→ Projection
```

禁止测试直接伪造最终 RuntimeState 或 ProgramProjection 来替代 telemetry semantics validation。

`packages/testkit` 可以对输入注入：

- packet drop；
- duplicate；
- reorder；
- jitter；
- disconnect / reconnect；
- time acceleration；
- slow consumer；
- source generation change。

## 9. CSTV GameEvent 边界

`packages/telemetry-cstv` 是第三方 CSTV parser 的 isolation layer。

它负责：

- 读取 CSTV fragment；
- 维护 source-local generation / sequence / tick / health；
- 将支持的 GameEvent 立即复制为 Broadcast-owned scalar observation；
- 将 parser exception 转成受控 source diagnostic。

它不负责：

- 修改 RuntimeState；
- 推导 Program fallback；
- 建立第二套 event-sourcing；
- 渲染 HUD / Radar；
- 决定 canonical 比赛事实。

Program 与 Lookahead 具有独立 source-local continuity。Lookahead reconnect 必须让旧 timeline alignment 失效，但不能仅因为连接重建就改变 Program `mapEpoch`。

### 9.1 Program CSTV live-only consumer

`CstvSourceManager<R>` 在类型边界固定 source role，并提供 live-only event subscription：

```ts
subscribeLiveGameEvents(
  listener: (event: RoleScopedGameEventObservation<R>) => void,
): () => void
```

事件在 `session.start()` / `connecting` 阶段仍会进入有界 `recentGameEvents`，只作为 Debug/Operator
evidence；只有 `start()` 返回 `ready`、manager 进入 `live` 后，`run()` 阶段的新事件才会通知 live
listener。因此 reconnect 的 bootstrap/catch-up event 不会被当作新的 Program edge 补播。

`ProgramCueCoordinator` 只能接收 `CstvSourceManager<'program'>`，在 event 到达时读取当前
Program Runtime 的 freshness、`mapEpoch` 和已知 map name。stale/awaiting telemetry、明确错地图、
缺少 target/victim stable source player id 或非 live source 的 event 立即 drop，不进入等待队列。
Lookahead manager 没有进入 Program cue 的类型或 assembly 路径。

## 10. 时间与序列

本地 duration、timeout、staleness 和 interpolation 使用 monotonic clock。

跨进程、跨机器、报告和审计使用 UTC wall clock。

```text
monotonic → 过了多久
wall clock → 什么时候发生
```

sequence value 必须明确 scope，不能把 ingress sequence、runtime sequence、channel sequence 混成同一个编号。

## 11. 真实 Evidence 与 Fixture

真实 Windows + CS2 / CSTV 输入用于证明 source behavior；synthetic fixture 用于可重复覆盖边界条件。

当真实 capture 与旧 hypothesis 冲突时：

1. 保留原始 evidence；
2. 修正 source semantics；
3. 更新 adapter；
4. 从真实 capture 派生新的 sanitized fixture；
5. 删除已经不成立的兼容假设。

Reference corpus 应覆盖：

- warmup / freezetime / live / round end；
- halftime / side switch；
- map end / map change；
- disconnect / reconnect；
- source restart / generation change；
- Program 与 Lookahead alignment；
- long-running / slow-consumer behavior。

新增 capture 只为回答明确问题，不为了样本数量重复录制已经充分证明的场景。

### 11.1 Objective Clock qualification report

Capture V1 的真实 observer evidence 可通过现有 Production Capture Recorder 生成的原始
capture 做离线分析：

```text
pnpm qualification:objective-timing <capture-dir>
```

分析器分三层输出：measurement 只计算 active packet interval 的 p50/p95/p99/max、countdown
delta 与 monotonic residual、source-local state/phase residual、plant/defuse/explosion terminal
residual、provider/receive 时间证据、missing countdown spans 和 reconnect gaps；evidence
coverage 再验证真实 observer provenance、canonical production GSI config、8 个最小 objective
scenario，以及独立的 `objective-events.jsonl` CSTV/demo reference；qualification decision 最后
才组合这些 gate。报告只打印 allowlisted GSI config，不打印 token；原始 frames、manifest、
reference file 和 SHA-256 仍是证据源。

同一个 GSI payload 内的 bomb/phase 对齐只能作为 source-local consistency，不能证明 observer-visible
transition residual、common-mode fixed offset 或 random delay。没有独立 reference、真实 observer
provenance 或完整 scenario coverage 时，numeric result 必须保持 `INCONCLUSIVE`；synthetic fixture
可以测试 measurement 算法，但不能冒充 production qualification。

numeric 0.1 s 的 evidence gate 为 active packet interval p99 ≤ 200 ms、独立 reference transition
residual p95 ≤ 100 ms、独立 absolute offset ≤ 100 ms、canonical production config 匹配、完整
scenario coverage，并且 configured objective lease ≥ `3 × measured p99` 且不超过 Core policy
上限。lease 与 Core 共用 canonical policy；因此一次 capture 即使 0.1 s gate FAIL，也必须单独
报告 lease sufficiency。plant、defuse、explosion 三类 terminal residual 也必须各自有统计样本，
否则 terminal residual coverage gate 保持 `INCONCLUSIVE`；它们当前是 source-local measurement，
独立 reference 覆盖数量单独报告。`precision_time=3` 不构成 1 ms 保证，0.01 s 不承诺。

canonical production GSI config 的唯一代码来源是
`packages/telemetry-gsi/src/production-config.json`；analyzer 会对 capture manifest 的
`timeout`、`precision_time`、`buffer`、`throttle` 和 `heartbeat` 做规范化比较。

`objective-events.jsonl` 每行格式为：

```json
{"version":1,"referenceId":"cstv-plant-001","kind":"plant","source":"cstv","occurredAtMs":1234.5}
```

其中 `source` 只能是独立的 `cstv` 或 `demo` reference；没有该文件时 transition/absolute-offset
gate 为 `INCONCLUSIVE`。

## 12. 隐私与安全

Capture、日志和 fixture 必须：

- 移除 GSI token；
- 避免保存不必要账户身份；
- 对 player identity 使用可重复的脱敏方式；
- 保留验证 continuity 需要的结构，不通过删字段破坏语义；
- 在进入仓库前执行 sanitizer 和 integrity check。
