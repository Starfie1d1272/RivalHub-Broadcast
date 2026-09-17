# 协议与本地数据契约

本文记录当前有效的三类协议边界：

1. Broadcast 从赛事上下文提供方读取的比赛只读契约；
2. Companion 向本地 Program、Radar、Operator 和 Assist 提供的 WebSocket 快照协议；
3. Companion 向 Program 提供的短生命周期 transient cue 协议。

协议字段与精确字符串以代码 schema 为最终机器来源；本文负责解释语义、ownership 和兼容规则。

## 1. RivalHub 只读赛事上下文

RivalHub 连接模式通过 ``packages/rivalhub`` 消费公开、版本化的只读契约。Broadcast 不直连 RivalHub 数据库，也不导入 RivalHub 内部 domain 类型。

```text
RivalHub API / 同形 fixture / 本地 LKG
                ↓
packages/rivalhub
  parse → validate → convert
                ↓
packages/core
  MatchContext / ScheduleWindow / identity
```

``schemaVersion``、``revision``、来源和新鲜度属于 acquisition metadata，不进入纯 ``MatchContext``。

### 1.1 BroadcastManifestV1

当前 schema version：

```text
rivalhub.broadcast-manifest.v1
```

顶层结构：

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
  entrants: {
    a: BroadcastEntrantV1,
    b: BroadcastEntrantV1
  },
  maps: BroadcastMapV1[],
  veto: BroadcastVetoStepV1[],
  commentators: BroadcastCommentatorV1[]
}
```

Entrant 包含 ``entryId / name / logoUrl / roster``。Roster 中的选手包含 ``playerId / steam64 / displayName / avatarUrl / isStarter``。

地图包含 ``mapId / mapOrder / mapName / pickedByEntryId / teamAStartSide / scoreA / scoreB / completedAt``。``teamAStartSide`` 只表示地图起始边，不是整场永久 CT/T 映射。

时间字段保持赛事 authority 的原始语义：

```text
scheduledAt  计划开始时间
startedAt    官方实际开始时间
completedAt  官方完成时间
```

Broadcast 不从本地观测反向改写这些字段。

### 1.2 BroadcastScheduleWindowV1

当前 schema version：

```text
rivalhub.broadcast-schedule-window.v1
```

ScheduleWindow 是轻量赛程视图，只包含时间窗口内比赛的身份、状态、BO、阶段、比分和双方参赛实体，不复制 roster、BP、maps 或 commentator 细节。

窗口请求由：

```ts
{
  competitionId: string,
  from: string,
  to: string
}
```

唯一确定。内存绑定和 LKG 只有在该请求三元组完全兼容时才能复用，避免跨赛事或跨时间窗口泄漏旧数据。

### 1.3 结构校验与语义校验

所有 RivalHub read-side payload 先通过结构 schema，再通过语义 validator。

语义诊断使用：

```ts
{
  kind: "structural" | "semantic",
  severity: "warning" | "error",
  code: string,
  path: string,
  message: string
}
```

Blocking error 会阻止 candidate 进入 Core。可恢复的缺失信息保留为 warning，不通过猜测制造身份或赛事事实。

Steam64 始终以字符串处理，不转换成 JavaScript number。

## 2. 身份证明

赛事身份与运行时 side mapping 分离：

```text
CompetitionEntry.entryId
  参赛实体身份

playerId + Steam64
  选手官方身份

CT / T
  当前运行时阵营映射

observer slot / nickname
  显示或辅助诊断信息
```

运行时匹配只把 Steam64 作为稳定玩家键，不用昵称或 observer slot 兜底猜测身份。

身份状态：

```text
unbound
resolving
matched
degraded
mismatch
```

source generation 或 map epoch 改变后，旧 identity proof 失效，必须由新鲜 evidence 重新证明。

## 3. LKG 与本地恢复

MatchContext 与 ScheduleWindow 分别维护独立的 Last Known Good（LKG）缓存。

规则：

- 只有结构和 blocking 语义校验都通过的 payload 才能替换 LKG；
- 缓存保存原始 DTO 与必要 metadata，恢复时重新 parse、validate、convert；
- 写入使用临时文件 + 原子替换，失败时保留旧缓存；
- 切换比赛失败不能残留上一场上下文；
- 同一比赛刷新失败时可以继续使用当前内存绑定并标记过期；
- ScheduleWindow 失败不清除当前 MatchContext；
- latest-wins generation 防止旧请求晚返回后覆盖当前选择。

``stale`` 表示上下文获取或新鲜度问题，不等于 identity mismatch。

## 4. Local Protocol V1

Broadcast 本地协议用于 Companion → Program / Radar / Operator / Assist 的只读快照，以及
Companion → Program 的短生命周期 transient cue。两类消息共享 WebSocket 承载和安全策略，
但不共享 snapshot 的 latest-wins 语义。

### 4.1 版本

当前常量：

```text
localProtocolVersion = 1
programSchemaVersion  = 2
radarSchemaVersion    = 1
operatorSchemaVersion = 1
assistSchemaVersion   = 1
programCueSchemaVersion = 1
subprotocol = rivalhub-broadcast.local.v1
```

Local Protocol 版本与各 channel schema 版本独立。单个 channel payload 演进时，不要求其它 channel 或 WebSocket 子协议同步升级。

### 4.2 路由

```text
/local/v1/program
/local/v1/radar
/local/v1/operator
/local/v1/assist
/local/v1/program-cue
```

`program`、`radar`、`operator`、`assist` 是 snapshot channel；`program-cue` 是独立 transient
channel。每个 channel 有独立 Zod schema、DTO、发布器和接收状态，不存在一个包含全部字段的万能
union payload。

### 4.3 快照 envelope

通用 envelope：

```ts
{
  type: "snapshot",
  protocolVersion: 1,
  channel: "program" | "radar" | "operator" | "assist",
  schemaVersion: number,
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

``schemaVersion`` 由具体 channel schema 决定，不能假定所有 channel 都是 1。

``channelSeq`` 在 ``producerInstanceId + channel`` 范围内单调递增。``runtimeSeq``、``programSourceGeneration`` 与 ``mapEpoch`` 分别表达不同的连续性语义，不能互相替代。

### 4.3.1 Program transient cue envelope

`program-cue` 不伪装成 `type: "snapshot"`，也不进入 `ProgramSnapshot`。它只有自己的 schema
version 和最小 CSTV continuity cursor：

```ts
{
  type: "cue-baseline" | "cue",
  protocolVersion: 1,
  channel: "program-cue",
  schemaVersion: 1,
  channelSeq: number,
  cursor: {
    producerInstanceId: string,
    liveSessionId: string | null,
    mapEpoch: number,
    cstvProgramGeneration: number
  },
  cue?: {
    id: string,
    mapEpoch: number,
    source: { generation: number, sequence: number, tick: number },
    kind: "player-impact" | "player-elimination",
    // kind-specific Program-safe semantic fields
  }
}
```

`cue-baseline` 是每个新连接的第一条业务基线，也是 reset barrier；它只建立“从现在开始”的
接收上下文，不携带旧 cue。`cue` 每条只承载一个 semantic edge。`cstvProgramGeneration`、
CSTV source sequence 和 local `channelSeq` 分别属于 source continuity、source ordering 和
delivery ordering，不能互换；cue 不携带 GSI `programSourceGeneration`、`runtimeSeq` 或
`programReceiveSequence`。

### 4.4 Program schema v2

Program payload 只包含正式节目允许显示的信息：

- telemetry / context / identity 状态；
- 比赛、赛事和 BO 信息；
- canonical 或 neutral team presentation；
- 地图、比分、回合与时钟；
- 选手显示身份和装备状态；
- ``lifeState: alive | dead | unknown``；
- C4；
- 数据覆盖状态。

Program 不包含：

- player position / forward；
- grenade 世界状态；
- 地图几何；
- identity issue 细节；
- Raw GSI / Raw CSTV；
- LKG metadata；
- Lookahead / future 信息。

``lifeState`` 由 Core 的共享领域 helper 推导，Program 与 Radar 不各自重复根据 health 猜测。

### 4.5 Radar schema v1

Radar 快照包含当前雷达领域所需的比赛游标、新鲜度、身份状态、地图、选手、C4 和手雷等信息。雷达 schema 表达 domain frame，不承诺 React / SVG / Canvas 等具体渲染实现。

### 4.6 Operator schema v1

Operator 快照包含制作控制需要的比赛上下文、运行转换、身份和 source health。它可以比 Program 拥有更多运行诊断，但不能成为 Program 的数据来源。

### 4.7 Assist schema v1

当前 Assist schema 仅表达该通道的可用性与游标，不预留未经设计冻结的未来字段。Assist 负载发生不兼容演进时，只提升 Assist 自己的 schema version。

## 5. 接收规则

每个 WebSocket connection 使用独立 acceptance state。Snapshot connection 使用 snapshot
acceptance；`program-cue` connection 使用 cue-specific acceptance，不能把 transient message
写入当前 snapshot store。

接收方必须：

- 拒绝 protocol / channel / schema version 不兼容；
- 忽略重复或倒序 ``channelSeq``；
- 拒绝同一 producer 下 ``runtimeSeq`` 回退；
- 拒绝一个连接中途切换 ``producerInstanceId``；
- 在 ``liveSessionId``、``programSourceGeneration`` 或 ``mapEpoch`` 改变时重置对应连续性证明；
- `program-cue` 连接在 baseline 前不接受 cue；重复或倒序 `channelSeq` 忽略，允许 sequence gap；
  每个 baseline 最多保留最近 128 个 cue id 做 bounded dedupe。

新 producer 必须建立新连接和新 acceptance state。

## 6. 投递与背压

Snapshot channel 每条消息都是完整快照，不发送 delta、历史快照 ACK 或离线 history queue。

每个 subscriber 只保留：

```text
1 个正在发送
+ 1 个最新待发
```

新的待发快照覆盖旧待发快照。慢 subscriber 不阻塞其它 subscriber，也不能让内存队列随时间增长。

连接建立或重连后立即发送当前基线，不重放断线期间的旧快照。

`program-cue` 使用独立的 bounded delivery：每个 subscriber 保留 1 个 in-flight、最多 32 个
按 source order 排列的 pending cue FIFO，以及最多 1 个 pending baseline/reset barrier。队列溢出丢弃
最旧 pending cue 并记录 diagnostic；pending cue 超过 1000 ms monotonic age 在发送前丢弃。baseline
会清空旧 pending cue 并成为下一条 control message。没有 subscriber 时不保留 cue history；visual
TTL 不进入 wire，由 Renderer 自己管理。

## 7. WebSocket 承载与安全

Companion 使用同一 Fastify 实例提供网页静态资源和 Local Protocol WebSocket。

当前传输约束：

- 子协议：``rivalhub-broadcast.local.v1``；
- 默认监听：``127.0.0.1``；
- 本机回环模式只接受本机 HTTP(S) Origin；
- 非回环监听必须显式开启 ``LOCAL_WEB_LAN_MODE=1``；
- ``LOCAL_WEB_ALLOWED_ORIGINS`` 使用精确 Origin 允许列表；
- 本地 snapshot 与 transient channel 均为 server → browser 只读；
- 浏览器发送业务消息时以 close code ``1008`` 关闭；
- ``perMessageDeflate`` 关闭；
- 单条 WebSocket payload 上限 64 KiB；
- ``bufferedAmount`` 与序列化快照使用 256 KiB hard guard；
- ping/pong heartbeat 周期 15 秒，约 30 秒无 pong 时清理连接。

浏览器从当前页面 Origin 推导 ``ws:`` / ``wss:`` 地址。每次新连接建立独立 acceptance state；
收到第一份有效基线后重连退避重新计时。Program cue 还必须与当前 Program snapshot 的
`producerInstanceId`、`liveSessionId` 和 `mapEpoch` 相同；不一致时立即丢弃，不等待未来 snapshot，
也不比较 CSTV generation 与 GSI source generation。断线、刷新、baseline 或 Program continuity
reset 都从当前时刻重新开始，不补播旧动画。

## 8. 协议维护原则

- 精确 schema 以代码为准，本文不得保留已失效版本号；
- 不为兼容旧文档维持双重语义；
- 新字段如果改变既有必需语义，提升对应 schema version；
- Local Protocol 不承担 RivalHub API 的 authority；
- Raw GSI、第三方 CSTV parser shape 和整个 RuntimeState 都不能直接成为 wire contract；
- 用户界面本地化不改变协议精确字符串。
