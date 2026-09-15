# 产品需求基线

> 状态：**Baseline**  
> 本文优先记录“产品要做到什么”，不预先锁死 WebSocket 拓扑、桌面壳、具体框架 API 等实现细节。Runtime / Workspace 技术选择见 ADR-0002；RuntimeState、identity、delivery/backpressure 与跨仓 contract 边界见 ADR-0003；Program / Observer Assist 隔离见 ADR-0004；三条产品能力线、RivalHub 第一方集成与可移植性边界见 ADR-0005。

## 1. 产品定义

RivalHub Broadcast 是一套 **以 RivalHub 为第一方赛事集成、local-first 的 CS2 赛事制播运行时**。它不是单独一张 HUD，也不是第二套赛事数据库，而是在同一套 Shared Runtime Foundation 上承载三条产品能力线：

```text
Shared Runtime Foundation
  telemetry / continuity / identity / RuntimeState / replay / delivery
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
赛事与实时数据    正式节目制播    Observer Assist / Lookahead
Tournament &      Program       private future cue
Live Data         Production
```

### 1.1 赛事与实时数据

这条能力线负责把赛事 canonical context 与直播现场 observation 接起来，形成双向但不混淆 authority 的数据闭环：

```text
RivalHub
  Match / Roster / Schedule / BP / Branding / official result
                    ↓
Broadcast
  identity / runtime observation / live snapshot / reliable boundary evidence
                    ↓
RivalHub
  canonical reconciliation / public live projection / downstream distribution
```

目标不是让 operator 在本地重新建立 Team / Player / Match，而是直接消费已经维护好的赛事、队伍、选手、Logo、Steam64、BP、BO、赛程和品牌信息；直播产生的比分、地图、选手状态、Radar、临时统计和关键 boundary observation 再通过版本化 contract 返回 RivalHub。

`BroadcastLiveSnapshot` 可以成为 RivalHub 实时 Match 页面以及未来其它明确数据消费者的标准 producer input，但 Broadcast Companion 本身不演化成公网数据平台。公共 API、SSE、WebSocket 或其它云端分发方式由 RivalHub / 对应服务 owner 决定。

### 1.2 正式节目制播

这条能力线负责观众真正看到的 Program：从赛前 Waiting / Matchup / BP，到 Gameplay HUD / Radar，再到 Halftime、Map Result、InterMap、Match Result 和 OBS 输出。

Gameplay HUD 是核心 scene，但不是整个产品。产品目标是把整场比赛的节目工作流连接起来，并尽量避免赛事资料、BP、比分、Roster 和品牌信息在赛事网站、本地 HUD 与 OBS 之间重复录入。

### 1.3 Observer Assist / Lookahead

这条能力线只服务本机解说兼 OB。它利用与 Delayed Program 不同的 Lookahead timeline，在事件真正进入 Program 之前生成确定性的 future cue，帮助人提前准备切 POV。

Observer Assist 不是第二套 Program，不拥有官方输出资格；任何 future information 都不能进入 Program、#615 public live projection 或官方 OBS Program capture。

### 1.4 三条能力线共享底座，但不是三个独立系统

三条能力线共享 telemetry、source continuity、identity、RuntimeState、capture/replay、health/capability 和 bounded delivery 等基础设施，通过各自 projection / adapter / contract 消费同一运行时真相。

因此当前产品形态保持一个仓库、一套 Runtime 和一条 Major-first 实施路线，不因为未来可能独立分发某项能力而提前拆仓库或建设通用插件框架。

RivalHub 是当前默认、最完整的赛事集成，也是 official truth owner；但 `packages/core`、Radar、telemetry adapter 与 Lookahead alignment/cue scheduling 不应依赖 RivalHub 内部类型或在线实现。RivalHub-specific 数据通过公开 contract 和 adapter 注入。

最重要的产品边界仍然是：

> **Broadcast 产生 observation；RivalHub 决定 official truth。**

> **Observer Assist 是本机辅助显示层，不是第二套节目输出，也不是第二类现场用户。**

## 2. 用户与典型场景

当前 Major 的真实现场模型是：**单机、单人解说兼 OB**。同一个人在一台 CS2 观战/解说电脑上解说、手动切 POV 和完成现场制播，不区分独立 Caster 与 Director/Operator 岗位。

Perfect 当前实际提供同场成对 GOTV：

```text
No-delay GOTV
  当前实践例如 endpoint ...5
  不给人直接观看
  不进入 OBS
  只供机器 headless 解析 future event / timeline alignment

Delayed Program GOTV
  当前实践例如 endpoint ...6
  约 120 秒 spectator delay
  CS2 observer 实际连接
  HUD / Radar / Program 跟随该时间轴
  OBS 捕获该节目时间轴
```

因此：

- Broadcast 的正式 Program 按 delayed observer 实际看到的时间轴工作；
- 向 RivalHub #615 发送的 live snapshot 也来自 Delayed Program timeline；
- **网站不额外再叠加一层固定 120 秒 delay**；
- `...5 / ...6` 和约 120 秒只是当前 Perfect provider 的 deployment fact / discovery heuristic，不在 Core 中硬编码；
- no-delay Lookahead feed 不具备 Program eligibility，也不参与 Program fallback。

本地主要 surface：

```text
/program
  正式节目 HUD / Radar / scene
  → OBS Browser Source

/assist（最终 route/desktop 形态由实现 Issue 冻结）
  本机解说兼 OB 的透明 / click-through 辅助层
  → 只显示 Assist 信息
  → 不进入 OBS

/operator
  同一制作人员需要时使用的 Match/config/health/scene/incident/recovery/OBS/uplink 控制界面

/debug
  Raw/normalized telemetry、timing、identity、adapter diagnostics
```

`/operator` 是控制/诊断职责，不代表现场存在另一位“导播用户”。

## 3. 赛前工作流

### 3.1 赛事上下文

Operator 选择/连接一场 RivalHub Match 后，应获得至少：

- 当前赛事、阶段、比赛身份；
- `scheduledAt / startedAt / canonical status`；
- 双方 CompetitionEntry；
- MatchRoster 与 Steam64；
- 队名、简称、Logo、选手昵称与头像；
- BO 格式与规则；
- 排期；
- BP / veto；
- 当前系列赛地图与官方结果；
- coverage / commentator / stream context；
- 品牌与 sponsor 信息（存在时）；
- 前一场比赛与后一场比赛的节目上下文。

Broadcast 不再要求 operator 重新建立 Team / Player / Match 数据。

### 3.2 BP / Veto

当前需求明确为：

1. BP 的官方事实在 RivalHub 后台完成/核对；
2. 不要求 Broadcast 建立逐步实时 veto domain；
3. 不要求 #610 为 Broadcast 引入复杂实时 BP runtime；
4. Broadcast 获取完整 BP 后，将其转换成 **presentation timeline**；
5. 在正式进入 Gameplay 前的等待时间中，按赛事节目形式逐步展示 ban / pick / decider；
6. Operator 至少可以播放、暂停、上一步、下一步、重播和直接显示完整 BP；
7. 所有这些播放操作只改变节目状态，不修改 RivalHub canonical BP。

目标体验类似职业赛事的 BP 图卡动画，而不是后台一张图填一张图、OBS 再手工维护一次。

### 3.3 Waiting / Matchup

赛前页面应支持展示：

- 当前对阵双方；
- 队标与首发选手；
- BO 信息；
- 完整或逐步播放中的 BP；
- 当前比赛预计开始信息；
- 前一场比赛的赛果；
- 后一场比赛的预计时间与对阵；
- 后续可扩展 sponsor、公告、主播信息、倒计时等节目内容。

### 3.4 #610 lifecycle 与 preparation / observation

Broadcast/GSI 是可选 observation source，不是 RivalHub Match Runtime 的运行前提。

正常业务中：

```text
canonical BP 完整保存
→ 可以成为 #610 的正式 start evidence

trusted Broadcast observation
→ 可以提交 match_started / map_ended 等 candidate
→ #610 决定 canonical adoption
```

如果现实 gameplay 已可信发生，但 RivalHub 仍缺某项 preparation，系统不能因为准备事项缺失而否认已经发生的现实比赛。

`MatchPreparation` 与 `ObservationHealth` 是不同问题，不压成一个 `canStart` boolean。

### 3.5 Steam64 自动核验

Broadcast 应自动比较：

```text
canonical MatchRoster / active lineup Steam64
↕
Observed server players
```

一致时无需人工逐个确认。

不一致时：

- 明确 missing / unexpected player；
- identity / roster mapping 进入 mismatch/degraded；
- 不继续自动采用有身份冲突的 result candidate；
- 如果现实已经开始，仍保留已发生事实/evidence 供 #610 reconciliation，而不是假装比赛没有开始。

## 4. Gameplay HUD

Gameplay 是核心 scene，但不是整个产品。

第一版 HUD 至少应能表达：

- 当前地图；
- BO / series score；
- CT/T 当前比分与 round；
- phase / clock；
- 10 名选手；
- RivalHub 选手身份与当前 side mapping；
- HP / armor / helmet / kit；
- money / equipment value；
- active weapon / ammo；
- grenades；
- K / A / D 等直播统计；
- bomb 状态；
- round history；
- 当前观察选手。

展示字段需要具备配置能力。第一版不要求自由拖拽所有像素，但架构不能把字段、布局和效果硬编码成只能维护一套 HUD。

Renderer 消费 Broadcast 自己的 presentation projection，不直接消费 Raw GSI 或 RivalHub API。

## 5. Radar

Radar 是一等能力，不是一个附带静态 minimap。

初始架构至少应支持：

- 10 名选手实时位置；
- 朝向；
- 存活/死亡；
- 当前观察目标；
- marker 使用 observer slot 数字、Steam/RivalHub 头像、自定义图标等模式；
- bomb；
- grenade 实时位置；
- 已观察到的 grenade 运动轨迹；
- smoke / molotov / incendiary 等区域和剩余时间；
- flash / HE 等短时事件反馈；
- Nuke / Vertigo 等上下层处理；
- Radar 尺寸、透明度、信息密度等配置。

“已发生的轨迹”与“预测弹道”必须区分。没有地图碰撞/物理依据时，不得把简单速度外推包装成准确投掷预测。

Radar 通过 `MapGeometryProvider` 消费地图几何。当前默认 provider 计划复用 DAK `@cs2dak/maps` 的 calibration owner，但 Broadcast 不把 DAK package shape 直接变成自己的 Radar domain contract；地图图片/游戏资产的许可与来源另行处理。

Radar domain 与 renderer 分离：world→radar、floor、marker/utility semantics、interpolation/autozoom math 属于 Radar domain；React/SVG/Canvas/DOM 与 rAF scheduling 属于 Web presentation。

## 6. Observer Assist / Lookahead

Observer Assist 的第一阶段目标非常具体：**利用 no-delay GOTV 已经发生的击杀事实，在 Delayed Program timeline 到达该事件前约 10 秒提示解说兼 OB，帮助其提前手动切 POV。**

最小链路：

```text
No-delay GOTV
→ headless parser 观察到 player_death
→ attacker / victim / event tick / optional reliable location

Delayed Program GOTV
→ current program tick

Timeline alignment
→ 计算 kill 距离 Program 还有多久

约 T-10s
→ 本地 Assist Overlay
→ countdown + killer → victim + optional location

解说兼 OB
→ 手动决定切哪个 POV
```

第一阶段不把以下能力作为完成条件：

- 佯攻 / 主攻识别；
- engagement/story 聚类；
- 复杂 importance ranking；
- AI / physics prediction；
- full-auto observer / auto TAKE；
- 第二个 CS2 renderer。

这些能力可以继续在 RFC / future design 中研究，但只有真实使用证明基础 kill cue 不足时才进入主线。

Lookahead future data 必须满足：

- machine-only；
- wrong-match / map mismatch / alignment unhealthy 时 fail closed；
- 不进入 ProgramProjection；
- 不进入官方 OBS Program preset；
- 不进入 #615 public live projection；
- no-delay feed 故障只降级 Assist，不影响 Program；
- Program feed 故障不允许切换到 no-delay feed。

是否未来让 no-delay feed 参与 #610 更早 ReliableObservation，应作为独立 RivalHub-facing contract 决定，不因为数据存在自动扩张职责。

## 7. 高级实时视觉反馈

产品希望长期支持更接近职业赛事的实时反馈，例如：

- 玩家受到伤害时的 HUD 动画；
- 在 telemetry 能明确来源时，区分 AWP/狙击、HE、燃烧、普通子弹、刀等伤害反馈；
- clutch / multi-kill / ACE / knife 等事件动画；
- timeout / technical pause；
- C4 临近爆炸时的危险程度、生存/死亡预测提示。

这些能力不要求全部进入第一版，但第一版必须提供可扩展 capability 与 overlay 架构。

标准 GSI 无法可靠提供所有精确伤害来源，因此：

- 基础 GSI 条件下可以提供 generic health-delta feedback；
- 精确伤害来源需要未来 server game events、HLAE/MIRV 或其他增强 telemetry；
- UI 必须根据实际 telemetry capability 开启效果，不能伪造精度。

C4 伤害预测也不应在 UI 中写死传统距离公式。未来应通过独立、可版本化的 `BombDamageProvider` 提供预测。

## 8. Halftime

系统应从稳定后的比赛状态/transition 识别半场边界，并建议进入 Halftime scene，而不是因为单个 GSI frame 瞬时切换。

中场页面希望重点展示：

- 上半场比分；
- 队伍/选手半场统计；
- 系列赛上下文；
- 整体赛程；
- 下半场开始后正确完成 CT/T 与 CompetitionEntry 的 side mapping 切换。

CompetitionEntry 是稳定身份，CT/T 只是某一时刻的临时 side；任何 renderer 都不能假定“左队永远是 CT”或“Entry A 永远是某个 side”。

## 9. Map Result / Inter-map

BO3/BO5 的场间页面至少应支持：

- 上一图比分；
- 上一图关键直播统计；
- 当前系列赛比分；
- BP 全貌；
- 下一张地图；
- 下一图预计/准备状态；
- 前后赛程上下文。

Map Result 和 InterMap 可以是两个独立 BaseScene，以便先短暂突出本图结果，再进入较长的场间等待页面。

## 10. Match Result / 赛后

系列赛结束后，应进入 Match Result scene，并支持：

- 最终系列赛比分；
- 地图比分；
- 直播侧可验证的临时统计；
- 赛后节目收尾信息。

Broadcast 可以向 RivalHub #610 提交：

- `match_started / map_started / map_ended / series_ended` 等可靠 observation；
- live result candidate；
- session / identity / quality / health 信息。

Broadcast **不直接覆盖 RivalHub canonical result**。正常高置信 observation 是否自动 canonicalize，以及异常时如何审核/恢复，由 RivalHub Match Runtime 决定；Broadcast 只提供可靠 observation。

人工路径与自动 observation 最终应由 #610 汇入同一 canonical command/result service；Broadcast 不建立平行赛果流水线。

比赛结束后，Operator 应能看到或收到后续任务提示，例如 OCR、DAK Demo、VOD/赛后资料等，但 OCR/DAK 本身不进入 Broadcast 实时主循环。

## 11. 赛事与实时数据闭环

Broadcast 计划向 RivalHub #615 提供低频、标准化、latest-wins 的 `BroadcastLiveSnapshot`，而不是把 raw GSI 上传生产环境。这是“赛事与实时数据”能力线的 live egress 主路径，同时与第 3 节的 RivalHub context ingress 形成闭环。

语义链路：

```text
RivalHub canonical tournament context
        ↓
Broadcast Runtime
        ↑
Delayed Program timeline
        ↓
BroadcastLiveSnapshot
  Broadcast → RivalHub #615 producer payload
          ↓
EphemeralLiveProjection
  RivalHub 服务端维护的当前实时状态
          ↓
PublicLiveMatchProjection
  公共 Match 页面 read model
          ↓
RivalHub-owned realtime / API consumers
```

BroadcastLiveSnapshot 可逐步包含：

- live map；
- score / round / phase / clock；
- series state；
- players；
- radar position；
- grenades / bomb；
- freshness / health / quality。

原则：

- 本地 HUD 可以按 GSI 实际频率工作；
- cloud snapshot 应节流、coalesce、latest-wins；
- 高频 raw GSI 不进入 PostgreSQL 历史表；
- snapshot/projection 是 ephemeral observation，不是 official truth；
- stale / disconnect / wrong-match 必须可识别；
- #615 只跟随 Delayed Program timeline；no-delay future state 不进入公开网页；
- RivalHub 面向公开网页或其它明确数据消费者采用 SSE、WebSocket、Realtime、REST 或其他分发方式，不属于 Broadcast Core 的职责；
- Broadcast 不因“对外数据”能力而直接暴露 Companion 为公网数据服务。

## 12. Scene、Overlay 与 Operator

当前 BaseScene 集合：

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

临时节目反馈使用 `OverlayCue`，例如：

```text
Clutch
Ace
MultiKill
DamageFeedback
BombUrgency
Timeout
TechnicalWarning
```

`TechnicalPause` 可以按节目需要实现为 Gameplay overlay，也可以是独立完整画面；不在 Core 中提前锁死唯一视觉实现。

Scene engine 区分：

```text
suggestedScene  系统根据稳定状态/transition 给出的建议
activeScene     当前真正播出的 BaseScene
mode            auto | manual
```

自动逻辑不能强行覆盖 operator 的 manual scene。

Operator 是同一制作人员使用的节目控制/诊断界面，不代表现场存在第二位导播。核心工作应围绕：

- 当前 Match；
- production readiness；
- telemetry / identity / network health；
- scene / overlay；
- BP playback；
- 必要的节目 override；
- Observer Assist / timeline alignment health；
- RivalHub uplink / outbox 状态；
- OBS preset / integration；
- 异常诊断与恢复。

## 13. 可靠性与异常

必须从第一版考虑：

- GSI 断流；
- 网络抖动；
- RivalHub 暂时不可达；
- manifest 过期；
- Wrong Match；
- roster/Steam64 mapping 不完整；
- map mismatch；
- 服务器 restart / map restart；
- duplicate / out-of-order transition；
- renderer 处理不过来导致 backlog；
- Companion 重启恢复；
- OBS Browser Source 重连；
- Lookahead feed / alignment 失效。

Identity 至少需要表达：

```text
unbound
resolving
matched
degraded
mismatch
```

Wrong Match / `mismatch` 必须 fail closed：不能在身份不可信时继续向 RivalHub 上传错误 Match 的 public snapshot 或自动 result candidate，也不能自信地把错误队伍品牌显示到另一场比赛上；已经发生的 evidence 可以保留给 #610 reconciliation。

Lookahead degradation：

```text
Lookahead down / unhealthy
→ Program 继续
→ Assist 关闭或明确 degraded

Program down
→ Program 输入故障
→ 不使用 Lookahead feed 代替
```

Runtime 至少区分 `liveSessionId`、`producerInstanceId`、`mapEpoch` 与单调 `seq`，避免一个模糊 epoch 同时代表进程重启、reconnect、map restart 和切换 Match。

本地 staleness / timeout / interpolation 使用 monotonic clock；跨机器 `observedAt` / `producedAt` / audit 使用 UTC wall clock。

## 14. 本地优先、离线与 Outbox

已经加载过的比赛上下文与节目资产应支持本地缓存。

RivalHub 断网后：

- Gameplay HUD 继续；
- Radar 继续；
- Scene 继续；
- Observer Assist 在本地输入健康时继续；
- 本地 provisional stats 继续；
- canonical/high-impact 操作禁用或明确失败；
- 恢复连接后先刷新 revision 和重新验证 identity，再恢复 uplink。

必须区分：

```text
Canonical / high-impact command
→ 离线时不得静默排队、联网后自动执行

ReliableObservation
→ 可进入 bounded durable outbox
→ reconnect 后重新校验 session / mapEpoch / revision / identity
→ 仍有效才 retry
```

例如 `map_ended` observation 不应因为 3 秒断网永久丢失，但它的 retry 也不等于 Broadcast 离线替 RivalHub 写 canonical result。

## 15. OBS production integration

OBS control channel 不是 Core 的运行依赖，但“一键创建 / 校验 RivalHub Program preset”是正式 production integration 能力。

官方 preset 至少应表达：

```text
RivalHub Program Scene
├─ CS2 Program Capture（Delayed GOTV）
├─ /program Browser Source
└─ 其它明确允许播出的 Program assets
```

规则：

- Observer Assist surface/window 不得进入官方 Program preset；
- Display Capture 等可能把 topmost Assist Overlay 一起采集的方式必须提示泄漏风险；
- obs-websocket 可用于初次配置、检测、修复及未来可选 scene control；
- OBS control channel 断开后，已经建立的 `/program` Browser Source 必须继续工作；
- 深度 auto-director / 复杂 OBS orchestration 不作为基础 Program output 前提。

## 16. 测试与可复现性

项目必须拥有自己的：

- production raw/sanitized GSI recorder；
- replay；
- simulator；
- fixture；
- packet drop/jitter/duplicate/reorder/reconnect 测试；
- slow-consumer/backpressure 测试；
- wrong-match/map-restart 测试；
- Program/Assist future-field non-leak 测试；
- Lookahead alignment/fail-closed 测试；
- visual regression；
- 长时间 soak test。

Simulator/replay 必须走与生产相同的 GSI ingress/normalizer，不允许直接伪造最终 `RuntimeState` / projection 绕过真正的数据链路。

Snapshot consumer 必须证明 queue/memory 不随运行时间增长；Browser reconnect 获取 current baseline projection 后继续，不重放离线期间全部旧 snapshot。

正式赛事前必须完成真实 Windows + CS2 spectator + OBS 长时间彩排；Observer Assist 进入实现后还要验证 topmost overlay 不会进入正式 Program 输出。

## 17. V1 产品范围与实施 Gate

V1 的产品目标覆盖三条能力线，但共享同一 Runtime Foundation，不要求三个独立部署单元。

**赛事与实时数据：**

- RivalHub Match 上下文接入；
- wrong-match / roster mismatch diagnostics；
- offline cache / reconnect / recovery；
- #610 ReliableObservation；
- #615 BroadcastLiveSnapshot。

**正式节目制播：**

- Waiting / Matchup；
- BP playback；
- Gameplay HUD；
- Radar；
- grenade / smoke / inferno 基础展示；
- KDA / ADR / round history 等直播临时统计；
- Halftime / Map Result / InterMap / Match Result；
- 单一 OBS Program Browser Source；
- Operator / Debug surface；
- 官方 OBS Program preset 的创建/校验能力。

**Observer Assist / Lookahead：**

- Observer Assist 的最小 future kill cue 与 Program non-leak；
- Lookahead alignment/fail-closed；
- Assist surface 的真实环境 non-leak 验收。

**共享 Runtime Foundation：**

- record/replay/simulator；
- continuity / identity / capability / health；
- bounded delivery / backpressure；
- consumer-specific projections。

阶段划分以 `docs/roadmap.md` 为准。Observer Assist 第一阶段以确定性 kill cue 为完成标准；更复杂的 engagement/story/AI/auto-director 继续作为后续增强。

“不做一次性 MVP”不等于所有功能必须在第一批代码同时完成。

## 18. 明确预留、但不是当前 V1 完成承诺

- 精确伤害来源特效；
- server game-event adapter；
- baked C4 damage prediction；
- engagement/story classification；
- AI / model prediction advisory；
- full-auto observer / auto TAKE；
- OBS WebSocket 深度 scene orchestration；
- automatic replay；
- camera grid / player camera；
- telestrator；
- Stream Deck；
- MulNX/HLAE adapter；
- LHM/OpenHUD compatibility；
- 自由拖拽 Layout Editor；
- Electron/Tauri desktop shell；
- 动态第三方 plugin marketplace。

## 19. 与 RivalHub Issues / DAK 的关系

当前 ownership：

- **RivalHub #610**：Match Runtime；负责 Match Live Session、canonical lifecycle/result、人工与 observation 汇入同一 canonical service、reconciliation/recovery。Broadcast 不拥有 canonical mutation policy。
- **RivalHub #615**：Live Match Projection；负责 BroadcastLiveSnapshot ingest、EphemeralLiveProjection、realtime distribution 与 public LIVE read model；只消费 Delayed Program timeline 的公开 snapshot。
- **RivalHub #452**：公共 Match 页面基础产品与页面 owner；#615 在其稳定结构上增加 LIVE mode，Broadcast 不拥有公共站 UI。
- **RivalHub #613**：本项目 tracking/product boundary issue；主仓描述跨仓业务边界，本仓库 docs/ADR 拥有本地 runtime 的具体实现架构。
- **DAK / RivalHub #268**：负责赛后 Demo evidence 与更高质量统计，不进入 Broadcast 的低延迟实时主循环；地图 calibration 可通过稳定 provider contract 复用。

跨仓库只通过公开 versioned contract 工作，不共享数据库内部结构，也不要求两个仓库共享源码类型。