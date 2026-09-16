# M2 Read-side Contract 与本地上下文

本文记录 M2-01（Issue #28）已经冻结并实现的 read-side contract。它描述
Broadcast 如何消费 RivalHub 的赛事只读事实，以及在 RivalHub 暂时不可用时如何用同形
fixture/LKG 继续建立当前比赛上下文。

本文不是 `packages/protocol` 的浏览器 wire schema。Companion 到 Program、Radar、Operator
的本地 wire DTO 属于后续 #29；本文不会为它提前定义万能 payload。

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
`scheduledAt` 升序排列；相同时间以及无时间项按 `matchId` 作确定性 fallback。窗口失败
不会解除当前 MatchContext，也不会影响当前 Program。

## Validator 与领域分层

两套 contract 都先经过 strict structural schema，再经过 semantic validator。validator
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
Steam64、partial roster、地图/veto order 与 entry 引用、score pair、nullable ISO
timestamp、ScheduleWindow 时间范围、matchId 唯一和 deterministic sort。缺少
Steam64/displayName 是可表达的 warning；重复 canonical Steam64、未知 entry 引用、
错误时间和结构错误是 blocking error。validator 不把 Steam64 转成 JavaScript number，
也不推断 `startedAt` 的 authority。

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
matched → 完整 roster、当前选手和动态 CT/T side mapping 相互一致
degraded → 没有明确错场证据，但 evidence 或 roster 不完整
mismatch → 存在明确 canonical contradiction
```

完整 roster 中的合法替补仍可保持 `matched`，但产生
`lineup_differs_from_expected` warning。未知 BOT/非 Steam64 source id 不按昵称猜人；
可识别的其它玩家继续保留，实体本身为 unresolved。unexpected human Steam64、重复
observed Steam64、完整 evidence 下的错误 live map 会关闭 canonical branding 和
identity-dependent result capability，但 neutral telemetry、operator/debug 和诊断继续
可用。

半场与加时换边只更新 entry 到 CT/T 的动态 side mapping，不改变 player/entry identity。
resolver 优先使用当前 map side team evidence，在该 evidence 不足时使用已映射选手的
当前 side。单帧 allplayers absent/degraded 会在同一 source generation/map epoch 下保留
已有 proof；source generation 或 map epoch 变化会先清除旧 baseline，直到新 evidence
重新证明。warmup/初始化阶段的未知地图不会直接制造 mismatch。

## Fixture 与 LKG

`packages/rivalhub/test/fixtures/` 中的 JSON 与未来 read-side shape 相同。Companion 的
fixture source 只负责读取 JSON，不另造 fixture-only domain shape。

Match LKG 与 ScheduleWindow LKG 是两个独立 seam：

- Match LKG 保存原始 Manifest JSON；每次恢复都重新 parse、validate、convert。
- candidate 只有 structural + blocking semantic validation 通过后才可替换 LKG。
- online/fixture 失败时只接受 `LKG.matchId === requestedMatchId` 的缓存，不选最近比赛。
- 切换 A → B 时先解除 A 的 active binding；B 失败时不会残留 A 的队名、logo 或 roster。
- 运行中的 fresh binding 标记 `online` 或 `fixture`；磁盘恢复标记 `cache` + `stale`，并
  保留原始缓存来源和存储时间。
- ScheduleWindow 可以独立刷新或恢复 stale LKG；它的失败不清除当前 MatchContext。

stale 是 context acquisition/freshness 事实，不是 identity mismatch；logo/avatar 资源
失败、schedule 离线、单个 GSI block 暂缺和 renderer/OBS 问题也不会被伪装成 identity
mismatch。

## M2 边界

本版只交付 read-side foundation、同形 fixture、validator、domain conversion、identity
resolver、LKG 和真实 semantic GSI replay acceptance。明确不包含：

- RivalHub 真实 HTTP/API endpoint、数据库访问或 #610 canonical `startedAt` 写路径；
- Broadcast → #610 `match_started` ReliableObservation uplink、pairing/auth、
  ReliableObservation/BroadcastLiveSnapshot 上传；
- HUD/Radar/Waiting/Matchup renderer、BP playback/动画、scene engine 或 OBS；
- #29 Program/Radar/Operator local protocol、浏览器 wire DTO；
- sponsor、coverage、entrant abbreviation 或 generic provider/plugin/cache framework。

真实 semantic capture 已由仓库 sanitizer 脱敏，capture 中的 `fixture-player-*` 不是
canonical identity。replay 测试只使用显式的测试侧 source-ID → 合法 Steam64 alias，
不根据昵称、observer slot 或数组位置猜身份；这不改变生产 resolver 的 Steam64-only
规则，也不把脱敏值当作生产 Steam64。
