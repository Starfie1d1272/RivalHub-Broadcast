# 产品需求基线

> 状态：**Baseline**  
> 本文优先记录“产品要做到什么”，不预先锁死 WebSocket 拓扑、桌面壳、具体框架 API 等实现细节。Runtime / Workspace 技术选择见 ADR-0002；RuntimeState、identity、delivery/backpressure 与跨仓 contract 边界见 ADR-0003。

## 1. 产品定义

RivalHub Broadcast 是一套围绕 RivalHub Match 工作的 **CS2 本地赛事制播运行时**。

目标不是建立通用 Team/Player/Match 数据库，也不是单独做一张 HUD；目标是把一场比赛从赛前等待、BP 展示、正式比赛、中场、场间到赛后展示连接成同一条节目工作流，并尽量避免重复录入赛事信息。

正常使用中，赛事事实在 RivalHub 维护一次：

```text
RivalHub
  Match / Roster / Schedule / BP / Branding / official result
                    ↓
Broadcast
  telemetry / runtime state / scenes / HUD / radar / provisional stats
                    ↓
Program / OBS
```

最重要的产品边界：

> **Broadcast 产生 observation；RivalHub 决定 official truth。**

## 2. 用户与典型场景

首要用户是校内赛事的导播/解说制作人员。典型环境为一台 CS2 观战/解说电脑接收比赛画面与 GSI，本地 Broadcast 输出 Program 页面给 OBS；未来允许扩展到观战机与 OBS 机分离的局域网工作方式。

当前 Major 的现实流程中，观战/解说端看到的比赛本身已经带约 120 秒 spectator delay。因此：

- Broadcast 按观战端实际看到的时间轴工作；
- 向 RivalHub 网站发送的 live snapshot 也来自这一路观战端；
- **网站不额外再叠加一层固定 120 秒 delay**；
- 该条件是当前赛事运行假设，不应在 Broadcast Core 中硬编码成固定延迟规则。

## 3. 赛前工作流

### 3.1 赛事上下文

Operator 选择/连接一场 RivalHub Match 后，应获得至少：

- 当前赛事、阶段、比赛身份；
- 双方 CompetitionEntry；
- MatchRoster 与 Steam64；
- 队名、简称、Logo、选手昵称与头像；
- BO 格式与规则；
- 排期；
- BP / veto；
- 当前系列赛地图与官方结果；
- 解说、直播、品牌与 sponsor 信息（存在时）；
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

## 6. 高级实时视觉反馈

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

## 7. Halftime

系统应从稳定后的比赛状态/transition 识别半场边界，并建议进入 Halftime scene，而不是因为单个 partial GSI payload 瞬时切换。

中场页面希望重点展示：

- 上半场比分；
- 队伍/选手半场统计；
- 系列赛上下文；
- 整体赛程；
- 下半场开始后正确完成 CT/T 与 CompetitionEntry 的 side mapping 切换。

CompetitionEntry 是稳定身份，CT/T 只是某一时刻的临时 side；任何 renderer 都不能假定“左队永远是 CT”或“Entry A 永远是某个 side”。

## 8. Map Result / Inter-map

BO3/BO5 的场间页面至少应支持：

- 上一图比分；
- 上一图关键直播统计；
- 当前系列赛比分；
- BP 全貌；
- 下一张地图；
- 下一图预计/准备状态；
- 前后赛程上下文。

Map Result 和 InterMap 可以是两个独立 BaseScene，以便先短暂突出本图结果，再进入较长的场间等待页面。

## 9. Match Result / 赛后

系列赛结束后，应进入 Match Result scene，并支持：

- 最终系列赛比分；
- 地图比分；
- 直播侧可验证的临时统计；
- 赛后节目收尾信息。

Broadcast 可以向 RivalHub #610 提交：

- observed map-end / series-end observation；
- live result candidate；
- session / identity / quality 信息。

Broadcast **不直接覆盖 RivalHub canonical result**。正常高置信 observation 是否自动 canonicalize，以及异常时如何审核/恢复，由 RivalHub Match Runtime 决定；Broadcast 只提供可靠 observation。

比赛结束后，Operator 应能看到或收到后续任务提示，例如 OCR、DAK Demo、VOD/赛后资料等，但 OCR/DAK 本身不进入 Broadcast 实时主循环。

## 10. RivalHub 网站实时数据

Broadcast 计划向 RivalHub #615 提供低频、标准化、latest-wins 的 `BroadcastLiveSnapshot`，而不是把 raw GSI 上传生产环境。

语义链路：

```text
BroadcastLiveSnapshot
  Broadcast → RivalHub #615 producer payload
          ↓
EphemeralLiveProjection
  RivalHub 服务端维护的当前实时状态
          ↓
PublicLiveMatchProjection
  公共 Match 页面 read model
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

- 本地 HUD 可以按 GSI 频率工作；
- cloud snapshot 应节流、coalesce、latest-wins；
- 高频 raw GSI 不进入 PostgreSQL 历史表；
- snapshot/projection 是 ephemeral observation，不是 official truth；
- stale / disconnect / wrong-match 必须可识别；
- RivalHub 面向公开网页采用 SSE、WebSocket、Realtime 或其他分发方式，不属于 Broadcast Core 的职责。

## 11. Scene、Overlay 与 Operator

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

临时反馈使用 `OverlayCue`，例如：

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

Operator 是节目控制者，不是第二个赛事数据库管理员。核心工作应围绕：

- 当前 Match；
- production readiness；
- telemetry / identity / network health；
- scene / overlay；
- BP playback；
- 必要的节目 override；
- RivalHub uplink / outbox 状态；
- 异常诊断与恢复。

## 12. 可靠性与异常

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
- OBS Browser Source 重连。

Identity 至少需要表达：

```text
unbound
resolving
matched
degraded
mismatch
```

Wrong Match / `mismatch` 必须 fail closed：不能在身份不可信时继续向 RivalHub 上传当前 Match 的 snapshot / reliable observation，也不能自信地把错误队伍品牌显示到另一场比赛上。

Runtime 至少区分 `liveSessionId`、`producerInstanceId`、`mapEpoch` 与单调 `seq`，避免一个模糊 epoch 同时代表进程重启、reconnect、map restart 和切换 Match。

本地 staleness / timeout / interpolation 使用 monotonic clock；跨机器 `observedAt` / `producedAt` / audit 使用 UTC wall clock。

## 13. 本地优先、离线与 Outbox

已经加载过的比赛上下文与节目资产应支持本地缓存。

RivalHub 断网后：

- Gameplay HUD 继续；
- Radar 继续；
- Scene 继续；
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

## 14. 测试与可复现性

项目必须拥有自己的：

- raw GSI recorder；
- replay；
- simulator；
- fixture；
- packet drop/jitter/duplicate/reorder/reconnect 测试；
- slow-consumer/backpressure 测试；
- wrong-match/map-restart 测试；
- visual regression；
- 长时间 soak test。

Simulator/replay 必须走与生产相同的 GSI ingress/normalizer，不允许直接伪造最终 `RuntimeState` / projection 绕过真正的数据链路。

Snapshot consumer 必须证明 queue/memory 不随运行时间增长；Browser reconnect 获取 current baseline projection 后继续，不重放离线期间全部旧 snapshot。

正式赛事前必须完成真实 Windows + CS2 spectator + OBS Browser Source 的长时间彩排。

## 15. V1 产品范围与实施 Gate

V1 的产品目标仍覆盖：

- RivalHub Match 上下文接入；
- Waiting / Matchup；
- BP playback；
- Gameplay HUD；
- Radar；
- grenade / smoke / inferno 基础展示；
- KDA / ADR / round history 等直播临时统计；
- Halftime / Map Result / InterMap / Match Result；
- 单一 OBS Browser Source 的 Program；
- Operator / Debug surface；
- wrong-match diagnostics；
- offline cache / reconnect / recovery；
- record/replay/simulator；
- #610 ReliableObservation；
- #615 BroadcastLiveSnapshot。

实现不要求所有能力同时铺开，按可验证 vertical slice 推进：

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
grenade / smoke / inferno
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

“不做一次性 MVP”不等于所有功能必须在第一批代码同时完成。

## 16. 明确预留、但不是当前 V1 完成承诺

- 精确伤害来源特效；
- server game-event adapter；
- baked C4 damage prediction；
- OBS WebSocket 深度控制；
- automatic replay；
- camera grid / player camera；
- telestrator；
- Stream Deck；
- MulNX/HLAE adapter；
- LHM/OpenHUD compatibility；
- 自由拖拽 Layout Editor；
- Electron/Tauri desktop shell；
- 动态第三方 plugin marketplace。

## 17. 与 RivalHub Issues / DAK 的关系

当前 ownership：

- **RivalHub #610**：Match Runtime & Operations；负责 ReliableObservation ingest、Match Live Session、canonical lifecycle/result、reconciliation/recovery。Broadcast 不拥有 canonical mutation policy。
- **RivalHub #615**：Live Match Projection；负责 BroadcastLiveSnapshot ingest、EphemeralLiveProjection、realtime distribution 与 public LIVE read model。
- **RivalHub #452**：公共 Match 页面基础产品与页面 owner；#615 在其稳定结构上增加 LIVE mode，Broadcast 不拥有公共站 UI。
- **RivalHub #613**：本项目来源/tracking issue；详细 canonical 产品/架构规格以本仓库文档为准。
- **DAK / RivalHub #268**：负责赛后 Demo evidence 与更高质量统计，不进入 Broadcast 的低延迟实时主循环；地图 calibration 可通过稳定 provider contract 复用。

跨仓库只通过公开 versioned contract 工作，不共享数据库内部结构，也不要求两个仓库共享源码类型。