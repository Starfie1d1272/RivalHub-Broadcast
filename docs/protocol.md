# M2 Read-side Contract 与本地上下文

本文记录 M2-01（Issue #28）已经冻结并实现的 read-side contract。它描述
Broadcast 如何消费 RivalHub 的赛事只读事实，以及在 RivalHub 暂时不可用时如何用同形
fixture/LKG 继续建立当前比赛上下文。

本文不是浏览器端或 RivalHub-facing 的万能 wire schema。Companion 到 Program、Radar、
Operator、Observer Assist 的本地 DTO 在文末以独立的 Local Protocol V1 章节记录；它们不
改变上面的 RivalHub read-side authority，也不会合并成一个万能 payload。

## Authority 与数据流

RivalHub 是赛事事实的唯一 authority。Broadcast 不建立第二套赛事数据库，也不直接读写
RivalHub 数据库。M2 的 `packages/rivalhub` 只拥有 Broadcast 对 RivalHub read-side
contract 的 adapter、结构解析、语义校验和领域转换。

```text
未来 RivalHub read API / M2 同形 fixture / Match LKG
                         ↓
packages/rivalhub: structural parse → semantic validation → DTO
                         ↓
packages/core: MatchContext / ScheduleWindow / identity resolver
                         ↓
Companion Runtime 与后续 projection
```

`schemaVersion`、`revision`、`online|fixture|cache` provenance 和 stale freshness 都是
adapter/acquisition metadata，不进入 Core 的纯 `MatchContext`、`ScheduleWindow` 或
identity key。Raw GSI 仍只属于 telemetry adapter；它不会穿过本 contract 直接进入 Core
或未来浏览器协议。

## BroadcastManifestV1

Manifest 是当前选中比赛的完整官方只读上下文，schema version 固定为
`rivalhub.broadcast-manifest.v1`。顶层字段为：

```ts
{
  schemaVersion: "rivalhub.broadcast-manifest.v1",
  revision: string,
  match: {
    matchId: string,
    competition: {
      competitionId: string,
      slug: string,
      name: string,
      themeColor: string | null
    },
    status: "scheduled" | "in_progress" | "finished" | "cancelled",
    format: "bo1" | "bo3" | "bo5",
    stage: string,
    round: number | null,
    entryRound: string | null,
    scheduledAt: string | null,
    startedAt: string | null,
    completedAt: string | null,
    scoreA: number | null,
    scoreB: number | null,
    isForfeit: boolean
  },
  entrants: { a: BroadcastEntrantV1, b: BroadcastEntrantV1 },
  maps: BroadcastMapV1[],
  veto: BroadcastVetoStepV1[],
  commentators: BroadcastCommentatorV1[]
}
```

其中 `BroadcastEntrantV1` 为 `entryId / name / logoUrl` 与完整 `roster`；roster 中每名
选手为 `playerId / steam64 / displayName / avatarUrl / isStarter`。`steam64`、显示名和
资源 URL 可以为 `null`。名单表达完整首发与替补，而不是只发送 effective starters。

`BroadcastMapV1` 包含 `mapId / mapOrder / mapName / pickedByEntryId /
teamAStartSide / scoreA / scoreB / completedAt`；`BroadcastVetoStepV1` 包含
`stepOrder / actionType / mapName / entryId / side`；`BroadcastCommentatorV1` 包含
`userId / displayName / avatarUrl / liveStreamUrl`。地图的 `teamAStartSide` 是官方起始边
事实，不是整场永久的 CT/T 映射。

### 时间 authority

三个时间字段保持 RivalHub 的原始 canonical 语义：

```text
scheduledAt = 计划开始时间
startedAt   = RivalHub #610 收敛后的实际正式开始时间
completedAt = RivalHub 采用的实际完成时间
```

V1 中 `startedAt` 必须存在且可为 `null`；validator 只校验它的 nullable ISO timestamp
形状，不猜测证据来源，也不在 converter 中推导或改写它。Broadcast 将来可以从可信 runtime
边界产生 `match_started` observation，但不能把本地 observation 直接写成 canonical
`startedAt`。完整 canonical BP 保存/确认和 trusted GSI/Broadcast observation 都是 #610
允许收敛的 start evidence；#610 负责选择最早可信正式开始证据、纠正和 audit。M2 不实现
#610 的服务端存储、command/service 或 Broadcast uplink。

## BroadcastScheduleWindowV1

赛程窗口是独立的轻量 read-side contract，schema version 固定为
`rivalhub.broadcast-schedule-window.v1`。它包含 `revision`、同样的 competition、
`from`、`to` 与 `matches`。每个 match 只包含身份、时间、状态、BO、阶段、round、forfeit、
比分及 `entrantA/entrantB { entryId, name, logoUrl }`；不复制 roster、BP、maps 或
commentators。

窗口要求 `from <= to`、`matchId` 唯一、A/B entry 不同，时间字段可为 `null`。输出按
`scheduledAt` 升序排列；相同时间以及无时间项按 `matchId` 作确定性 fallback。Companion
的 acquisition 还会为每次请求携带 `ScheduleWindowRequest { competitionId, from, to }`，
source response、内存 binding 与磁盘 LKG 必须与该三元组完全一致；不兼容的赛事或时间窗口
不得作为 fallback。V1 暂采用 exact window compatibility，滚动窗口若未来需要放宽必须单独
冻结兼容规则。窗口失败不会解除当前 MatchContext，也不会影响当前 Program。

## Validator 与领域分层

两套 contract 都先经过 structural schema，再经过 semantic validator。schema 对已知字段的
形状保持严格；未来在同一 V1 中增加的可选字段会在 parse 时剥离，不会阻断旧 consumer，
也不会穿过 Core。只有改变既有语义或必需字段的变化才提升 `schemaVersion`。validator
返回可枚举的 `ContractDiagnostic`，至少包含：

```ts
{
  kind: "structural" | "semantic",
  severity: "warning" | "error",
  code: string,
  path: string,
  message: string
}
```

校验覆盖精确 version、非空 ID、A/B 不重复、Manifest 内全局唯一的 playerId 与非空
Steam64、partial roster、地图/veto order 与 entry 引用、format 对应的 canonical map 数量
上限、score pair、严格的 nullable ISO timestamp、ScheduleWindow 时间范围、matchId 唯一和
deterministic sort。缺少
Steam64/displayName 是可表达的 warning；重复 canonical Steam64、未知 entry 引用、
错误时间和结构错误是 blocking error。validator 不把 Steam64 转成 JavaScript number，
也不推断 `startedAt` 的 authority。V1 的 veto `actionType` 只接受 `ban`、`pick`、
`side_pick`、`decider`；`round`、`mapOrder`、`stepOrder` 均须为从 1 开始的安全整数（或
contract 允许为 `null` 的 `round` 保持为 `null`）。

只有没有 blocking error 的 candidate 才能转换为 Core domain。`MatchContext` 只保留
Broadcast-owned 的 provider-neutral 字段；`revision`、schema version、来源和 freshness
不会污染它。`ScheduleWindow` 同样是轻量领域模型，使用自己的 A/B entrant 投影。

## Identity proof

canonical entrant 只认 `CompetitionEntry.entryId`；canonical player 以
`playerId + Steam64` 表达，运行时实际匹配只认 Steam64 字符串。游戏昵称和
`observerSlot` 只能作为 evidence/diagnostic，不能作为 fallback identity key。

resolver 输出以下五态，并另外输出 typed `IdentityIssue[]` 与 capabilities：

```text
unbound → 没有 MatchContext
resolving → 有上下文，但当前 source generation/map epoch 尚无足够新鲜 evidence
matched → A/B canonical roster 各至少五名，当前 evidence 实际解析出双方各五名合法
Steam64 player，并且动态 CT/T side mapping 相互一致
degraded → 没有明确错场证据，但 evidence 或 roster 不完整
mismatch → 存在明确 canonical contradiction
```

canonical roster 的完整性与当前 10 人 evidence 的完整性独立判断；`isStarter` 只是预期
首发提示，不参与身份授权或 evidence 计数。完整 roster 中的合法替补仍可保持 `matched`，
但产生 `lineup_differs_from_expected` warning。未知 BOT/非 Steam64 source id 不按昵称猜人；
可识别的其它玩家继续保留，实体本身为 unresolved。unexpected human Steam64、重复
observed Steam64、完整 evidence 下的错误 live map 会关闭 canonical branding 和
identity-dependent result capability，但 neutral telemetry、operator/debug 和诊断继续
可用。

半场与加时换边只更新 entry 到 CT/T 的动态 side mapping，不改变 player/entry identity。
resolver 优先使用已经以 Steam64 解析到 CompetitionEntry 的 observed player 当前 side；
`map.team_ct/team_t.name` 只能作为 player evidence 不足时的 fallback 或 cross-check。两者
冲突时保留 player proof，并发出 typed `side_mapping_conflict`，不能让字符串队名覆盖已确认
的身份。单帧 allplayers absent/degraded 会在同一 source generation/map epoch 下保留已有
matched proof 与 canonical branding；degraded frame 仍先扫描当前帧的重复或其它正面身份
矛盾，正面矛盾可以将状态置为 mismatch。`allplayers_unavailable/allplayers_degraded` 只是独立的
freshness/health diagnostics，具体何时失效由 Runtime freshness policy 决定。source generation
或 map epoch 变化会清除旧 baseline，直到新 evidence 重新证明。warmup/初始化阶段的未知
地图不会直接制造 mismatch。只有当前 format 对应的完整 canonical map list 已确认，且 live
map 明确不在其中时才产生 `map_mismatch`；地图列表为空或尚未达到 BO1/BO3/BO5 的完整数量
时，对未知 live map 只产生 `map_not_confirmed` warning。

## Fixture 与 LKG

`packages/rivalhub/test/fixtures/` 中的 JSON 与未来 read-side shape 相同。Companion 的
fixture source 只负责读取 JSON，不另造 fixture-only domain shape。

Match LKG 与 ScheduleWindow LKG 是两个独立 seam：

- Match LKG 保存一个 versioned cache envelope：`metadata`（matchId、来源、存储时间）与
  原始 Manifest DTO `payload` 同在一个 JSON 文件中；每次恢复都重新 parse、validate、convert。
- ScheduleWindow LKG 使用同样的窄 durable-json helper 和独立 envelope version；不拆成
  payload/metadata 两个文件，也不建设通用 cache framework。
- candidate 只有 structural + blocking semantic validation 通过后才可替换 LKG。
- envelope 通过同目录临时文件加一次 atomic replace 提交；写入或提交失败会删除临时文件并
  保留旧 envelope，不会产生半更新的 metadata/payload 组合。
- online/fixture 失败时只接受 `LKG.matchId === requestedMatchId` 的缓存，不选最近比赛。
- 切换 A → B 时先解除 A 的 active binding；B 失败时不会残留 A 的队名、logo 或 roster。
- 同一 matchId 的 refresh 不会先清空当前 binding；source 失败时优先保留当前内存 binding
  并标记为 stale，再考虑磁盘 LKG。公开的 `clearActive()` 是 unbind/cancel 操作，会递增
  selection generation，已在途的旧 selection 不能重新激活。
- MatchContext selection 与 ScheduleWindow refresh 都带 request/refresh generation，最终
  active/current binding 与 LKG 只接受 latest-wins commit；旧 source 即使晚返回也不能覆盖
  当前绑定或缓存。
- ScheduleWindow 的 `ScheduleWindowController` 负责 source acquisition、current binding 与
  latest-wins；`ScheduleWindowLkgStore` 只负责磁盘读写。source 失败时优先使用当前内存
  ScheduleWindow，但仅当 `ScheduleWindowRequest` 完全兼容；随后才考虑同样兼容的磁盘 LKG，
  避免新内存版本倒退为旧磁盘版本或跨赛事/窗口泄漏。
- ScheduleWindow request 变化会解除不兼容的 current binding；公开 `clearCurrent()` 会递增
  refresh generation，已在途的旧 refresh 不能重新激活任何 schedule。
- Schedule source 已成功 validate 时，即使 LKG persistence 失败，仍继续使用 fresh binding，
  并将写入失败作为独立 diagnostic，不回退到 stale LKG。
- MatchContextBinding 与 ScheduleWindowBinding 都携带 validator 产生的 contract diagnostics；
  fresh binding 和 cache reload 都重新 validate 并保留这些 warning。
- 运行中的 fresh binding 标记 `online` 或 `fixture`；磁盘恢复标记 `cache` + `stale`，并
  保留原始缓存来源和存储时间。
- ScheduleWindow 可以独立刷新或恢复 stale LKG；它的失败不清除当前 MatchContext。

stale 是 context acquisition/freshness 事实，不是 identity mismatch；logo/avatar 资源
失败、schedule 离线、单个 GSI block 暂缺和 renderer/OBS 问题也不会被伪装成 identity
mismatch。

source 错误分类也保持分层：source adapter 将网络、可用性、文件读取和源格式 rejection
包装为 `SourceLoadError`，只有这类 `source.load()` 失败进入
`source_load_failed`/`schedule_source_failed`；validator、DTO converter 和 binding callback
不在同一个大 catch 中，分别保留 validation diagnostics 或向调用方传播其 invariant/callback
错误。未包装的异常按 programmer/invariant 错误传播。

`packages/rivalhub` 公共入口只暴露 V1 DTO 类型、schema version、完整 validator、领域
converter、typed diagnostics 与 conversion error；raw structural Zod schemas 仅供包内
validator 使用，调用方不得绕过 semantic validation。

## 完整比赛 replay 证据

semantic fixtures 继续只保留最小、可追溯的语义切片；`match/regulation-to-overtime` 的
provenance 仍是 `lifecycleCoverage: partial`，不被当作整场验收。整场 identity replay 使用
现有外部 Windows capture `20260914T060149Z-4cda66b7-recovered-match`：连续序列
`0..16381`、`16382` 帧、`droppedFrames=0`，`framesSha256` 为
`7a2dfed10f28903de6a94e782ca3f0955593fe2f653e7e831e05305d8e99347a`，其 manifest 记录
`de_ancient` 从正式比赛到 `14:16` gameover 的完整生命周期。该 raw capture 因含真实身份不
进入 Git；验收通过 `RIVALHUB_FULL_MATCH_CAPTURE_DIR` 指向经复核的 capture 目录运行，测试
helper 在构造 formal identity evidence 前做确定性脱敏。证据边界是本地 artifact 可复核，CI
不伪装成拥有该 raw capture；仓库内 semantic slice 仍独立执行。设置同一个环境变量后，
`apps/companion/test/projection-real-replay.test.ts` 会让每个 accepted frame 依次经过生产
GSI adapter/replay、ProgramRuntime、identity、ProjectionCoordinator 的 Program/Radar/
Operator/Assist projection 及最终 wire schema，使用 deterministic clock 跑两遍并比较去除
`channelSeq` 后的 canonical digest；canonical JSON 同时拒绝 `undefined`、`NaN` 和
`Infinity`。

## M2 边界

本版只交付 read-side foundation、同形 fixture、validator、domain conversion、identity
resolver、LKG 和真实 semantic GSI replay acceptance。明确不包含：

- RivalHub 真实 HTTP/API endpoint、数据库访问或 #610 canonical `startedAt` 写路径；
- Broadcast → #610 `match_started` ReliableObservation uplink、pairing/auth、
  ReliableObservation/BroadcastLiveSnapshot 上传；
- HUD/Radar/Waiting/Matchup renderer、BP playback/动画、scene engine 或 OBS；
- sponsor、coverage、entrant abbreviation 或 generic provider/plugin/cache framework。

真实 semantic capture 已由仓库 sanitizer 脱敏，capture 中的 `fixture-player-*` 不是
canonical identity。replay 测试只在 test/helper 层把 source ID 转成合法的伪造 Steam64，
然后才调用正式 resolver；不根据昵称或 observer slot 推断身份，也不让这些脱敏映射进入
Core public API。生产 resolver 的 observed identity key 始终只有 Steam64 字符串。

## Local Protocol V1（Issue #29）

本节是与 RivalHub read-side contract 独立的本地制播协议章节。它只描述 Companion 在本机
向各消费面提供的当前完整快照；不代表 RivalHub API，也不定义浏览器公开页面协议。RivalHub
仍是赛事事实 authority，Program 只消费 delayed Program timeline，no-delay Lookahead 只属
本机 Observer Assist advisory，不存在 Lookahead → Program fallback。

### 所有权与 channel

版本常量由 `packages/protocol` 维护，当前值固定为：

```text
localProtocolVersion = 1
programSchemaVersion = 1
radarSchemaVersion = 1
operatorSchemaVersion = 1
assistSchemaVersion = 1
subprotocol = rivalhub-broadcast.local.v1
```

V1 的 WebSocket route path 为：

```text
/local/v1/program   Program-safe 节目快照
/local/v1/radar     当前世界坐标的 Radar frame
/local/v1/operator  本机操作与诊断投影
/local/v1/assist    Observer Assist；当前仅表示 unavailable
```

channel 之间没有通用 union。每个 channel 有独立的 Zod schema、DTO、schema version 和
wire mapper；`packages/protocol` 不依赖 Core、Radar、RivalHub 或 Web/React。`packages/core`
只拥有 projection/domain，`packages/radar` 只拥有 framework-neutral Radar frame，Companion
负责将 projection 映射为本协议 DTO 和发布。

### 快照 envelope

每条消息都是完整快照，不发送 delta、history、ACK 或离线 outbox。Envelope 的 `channel`
使用短 channel id；其对应的 WebSocket route path 如上：

```ts
{
  type: "snapshot",
  protocolVersion: 1,
  channel: "program" | "radar" | "operator" | "assist",
  schemaVersion: 1,
  channelSeq: number,
  cursor: {
    producerInstanceId: string,
    liveSessionId: string | null,
    runtimeSeq: number,
    programSourceGeneration: number,
    programReceiveSequence: number | null,
    mapEpoch: number
  },
  payload: ChannelPayload
}
```

`channelSeq` 从 1 开始，并在 `producerInstanceId + channel` 范围内单调递增。`runtimeSeq`
只允许在同一 producer 内前进；它不是两条 ingress 的连接 generation，也不替代
`programSourceGeneration` 或 `mapEpoch`。重新连接时 consumer 只接受当前 baseline，不重放
历史快照。

Program payload 只包含 status、MatchContext/identity freshness、canonical team/player（按
当前 identity proof；canonical team presentation 的 `seriesScore` 位于各自 team，neutral
team 固定为 `null`）、map/round/clock、bomb、coverage 等节目安全字段；不包含位置、
grenade、地图几何、identity issue、LKG/raw GSI/raw CSTV、round history、scene 或
Lookahead/future 字段。Radar frame 只包含 cursor/freshness、identity state、map name、
observed player、coverage、all players、bomb、grenades；life state 由 health 明确派生，
不承诺额外几何变换。Operator projection 只包含 operator-safe runtime transition、context、
identity 和 source health。Assist V1 严格为 `{ cursor, availability: "unavailable" }`，不
预留 future payload 字段。

### 接受、重置与背压

每个 socket/consumer 使用独立 acceptance state。接收方必须先拒绝 schema、protocol、channel
或 schema version 错误；重复或倒序 `channelSeq` 静默忽略；同一 producer 下的
`runtimeSeq` 回退拒绝。一个 socket 中途更换 `producerInstanceId` 也拒绝，新的 producer
必须建立新的 acceptance state。`liveSessionId`、`programSourceGeneration` 或 `mapEpoch`
变化时产生显式 reset signal，并清除对应旧 baseline 的连续性证明；producer change 是拒绝
条件而不是 reset signal；source reconnect 后，
旧 Lookahead alignment 不能继续产生 Assist cue。

每个 subscriber 使用 latest-wins publisher：最多一个正在发送的快照和一个 pending 快照，
新快照覆盖旧 pending，不积累 history/outbox。发送失败的 subscriber 被移除并记录诊断；
慢 consumer 不得使内存队列随时间增长。Publisher close 后幂等关闭，且不再接受 publish
或新 subscriber。

### #29 的边界

本节冻结 schema、projector、wire mapper、publisher、acceptance helper 和 non-leak/背压测试。
它不实现真实 WebSocket route/host、origin/CORS/LAN policy、`bufferedAmount`、heartbeat、
浏览器 renderer、Radar geometry、Operator command、Observer Assist cue、RivalHub uplink 或
M3-B Lookahead。上述能力分别留给后续 issue；真实 Windows + CS2 spectator + OBS 彩排也不
由本 issue 虚构为已完成。

## Local Protocol V1 production transport implementation（Issue #32）

Issue #32 将上一节已经冻结的 Local Protocol V1 接入 production Companion，但不改变 DTO、
version 或 acceptance 语义。Companion 使用同一 Fastify instance 同时提供 `apps/web/dist`
静态资源和四条 WebSocket route：`/local/v1/program`、`/local/v1/radar`、
`/local/v1/operator`、`/local/v1/assist`。每条 socket 直接订阅对应的
`ProjectionCoordinator.getPublisher(channel)`，连接时从 publisher 当前快照开始，断线重连
也只重新取得当前 baseline，不补发历史。

WebSocket 使用 `rivalhub-broadcast.local.v1` subprotocol；缺失或不支持的 protocol、缺失或
不安全的 Origin 在 upgrade 前拒绝。默认 host 是 `127.0.0.1`，loopback mode 只接受
`127.0.0.1`、`localhost`、`::1` 的 HTTP(S) Origin；非 loopback 监听必须显式设置
`LOCAL_WEB_LAN_MODE=1` 和精确的 `LOCAL_WEB_ALLOWED_ORIGINS` allowlist。本地 snapshot lane
是 server → browser 的只读通道，browser application message 会以 close code `1008` 和
`read-only local snapshot channel` 关闭。

传输层关闭 `perMessageDeflate`，单次 WebSocket payload 上限为 64 KiB，并对
`bufferedAmount` 与序列化快照分别实施 256 KiB hard guard。publisher 继续保持一个
in-flight 加一个 pending latest；不创建 FIFO 或 history queue。共享 ping/pong heartbeat 每
15 秒运行，连续约 30 秒没有 pong 的 connection 被清理，shutdown 会同步清理 timer、socket
和 publisher subscription。

`apps/web` 使用浏览器原生 WebSocket，按当前页面 Origin 将 `http:`/`https:` 映射为
`ws:`/`wss:`，并直接使用 `packages/protocol` 的 channel schema 与
`createSnapshotAcceptance()`。每个新 connection 都有独立 acceptance state；固定重连退避为
`250/500/1000/2000/5000ms`，收到第一份 valid baseline 后重置。schema/channel 不兼容进入
terminal `protocol-error`，旧 connection callback 由 browser-side generation guard 忽略。
OBS Browser Source 的 unload/reload 等价于销毁旧 connection，再以新 connection 获取当前
baseline；不依赖旧的 localStorage、IndexedDB 或 history replay。真实 Windows + CS2 + OBS
验收仍由 #35 负责。
