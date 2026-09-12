# 产品需求基线

> 状态：**Draft for review**  
> 本文优先记录“产品要做到什么”，不预先锁死 WebSocket 拓扑、桌面壳、具体框架 API 等实现细节。当前内容来自 RivalHub #613 的需求讨论与参考项目调研，后续以本仓库 ADR 逐项冻结技术决策。

## 1. 产品定义

RivalHub Broadcast 是一套围绕 RivalHub Match 工作的 **CS2 本地赛事制播运行时**。

目标不是建立通用 Team/Player/Match 数据库，也不是单独做一张 HUD；目标是把一场比赛从赛前等待、BP 展示、正式比赛、中场、场间到赛后展示连接成同一条节目工作流，并尽量避免重复录入赛事信息。

正常使用中，赛事事实在 RivalHub 维护一次：

```text
RivalHub
  Match / Roster / Schedule / BP / Branding / official result
                    ↓
Broadcast
  telemetry / live state / scenes / HUD / radar / provisional stats
                    ↓
Program / OBS
```

## 2. 用户与典型场景

首要用户是校内赛事的导播/解说制作人员。典型环境为一台 CS2 观战/解说电脑接收比赛画面与 GSI，本地 Broadcast 输出 Program 页面给 OBS；未来允许扩展到观战机与 OBS 机分离的局域网工作方式。

当前 Major 的现实流程中，观战/解说端看到的比赛本身已经带约 120 秒 spectator delay。因此：

- Broadcast 按观战端实际看到的时间轴工作；
- 向 RivalHub 网站投影的 live state 也来自这一路观战端；
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

地图坐标标定应优先复用 DAK `@cs2dak/maps` 的既有 owner，而不是维护第二份 calibration 真相；地图图片/游戏资产的许可与来源另行处理。

## 6. 高级实时视觉反馈

产品希望长期支持更接近职业赛事的实时反馈，例如：

- 玩家受到伤害时的 HUD 动画；
- 在 telemetry 能明确来源时，区分 AWP/狙击、HE、燃烧、普通子弹、刀等伤害反馈；
- clutch / multi-kill / ACE / knife 等事件动画；
- timeout / technical pause；
- C4 临近爆炸时的危险程度、生存/死亡预测提示。

这些能力不要求全部进入第一版，但第一版必须提供可扩展 event/capability 架构。

标准 GSI 无法可靠提供所有精确伤害来源，因此：

- 基础 GSI 条件下可以提供 generic health-delta feedback；
- 精确伤害来源需要未来 server game events、HLAE/MIRV 或其他增强 telemetry；
- UI 必须根据实际 telemetry capability 开启效果，不能伪造精度。

C4 伤害预测也不应在 UI 中写死传统距离公式。Valve 现行 CS2 官方地图已使用地图编译相关的爆炸模拟；未来应通过独立、可版本化的 BombDamageProvider 提供预测。

## 7. Halftime

系统应从比赛状态识别半场边界，并建议进入 Halftime scene。

中场页面希望重点展示：

- 上半场比分；
- 队伍/选手半场统计；
- 系列赛上下文；
- 右侧或其他区域显示整体赛程；
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

Map Result 和 InterMap 可以是两个独立 scene，以便先短暂突出本图结果，再进入较长的场间等待页面。

## 9. Match Result / 赛后

系列赛结束后，应进入 Match Result scene，并支持：

- 最终系列赛比分；
- 地图比分；
- 直播侧可验证的临时统计；
- 赛后节目收尾信息。

Broadcast 可以向 RivalHub 提交：

- observed map-end / series-end 事件；
- live result candidate；
- session/identity/quality 信息。

Broadcast **不直接覆盖 RivalHub canonical result**。主仓最终采用自动 canonicalize 还是异常时人工审核，由 RivalHub Match Runtime 自己决定；Broadcast 只提供稳定 observation contract。

比赛结束后，Operator 应能看到或收到后续任务提示，例如 OCR、DAK Demo、VOD/赛后资料等，但 OCR/DAK 本身不进入 Broadcast 实时主循环。

## 10. RivalHub 网站实时数据

Broadcast 第一版架构应为网站实时能力做好准备，并计划提供低频、经过标准化的 live projection，而不是把 raw GSI 上传生产环境。

网站未来可消费：

- live map；
- score / round / phase / clock；
- series state；
- players；
- radar position；
- grenades / bomb；
- freshness / health / quality。

原则：

- 本地 HUD 可以按 GSI 频率工作；
- 云端 projection 应节流、latest-wins；
- 高频 raw GSI 不进入 PostgreSQL 历史表；
- projection 是 ephemeral observation，不是 official truth；
- stale / disconnect / wrong-match 必须可识别；
- RivalHub 面向公开网页采用 SSE、WebSocket、Realtime 或其他分发方式，不属于 Broadcast Core 的职责。

## 11. Scene 与 Operator

当前目标 scene 集合：

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
TechnicalPause
Emergency
```

Scene engine 应区分：

```text
suggestedScene  系统根据比赛状态给出的建议
activeScene     当前真正播出的场景
mode            auto | manual
```

自动逻辑不能强行覆盖 operator 的 manual scene。

Operator 是节目控制者，不是第二个赛事数据库管理员。核心工作应围绕：

- 当前 Match；
- production readiness；
- telemetry / identity / network health；
- scene；
- BP playback；
- 必要的节目 override；
- RivalHub uplink 状态；
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

Wrong Match 应 fail closed：不能在身份不可信时继续向 RivalHub 上传当前 Match 的 live state 或结果 candidate，也不能自信地把错误队伍品牌显示到另一场比赛上。

## 13. 本地优先与离线

已经加载过的比赛上下文与节目资产应支持本地缓存。

RivalHub 断网后：

- Gameplay HUD 继续；
- Radar 继续；
- Scene 继续；
- 本地 provisional stats 继续；
- canonical/high-impact 操作禁用或明确失败；
- 恢复连接后先刷新 revision 和重新验证 identity，再恢复 uplink。

危险操作不得在离线时排队、联网后自动补发。

## 14. 测试与可复现性

项目必须拥有自己的：

- raw GSI recorder；
- replay；
- simulator；
- fixture；
- packet drop/jitter/duplicate/reconnect 测试；
- visual regression；
- 长时间 soak test。

Simulator/replay 必须走与生产相同的 GSI ingress/normalizer，不允许直接伪造 BroadcastState 绕过真正的数据链路。

正式赛事前必须完成真实 Windows + CS2 spectator + OBS Browser Source 的长时间彩排。

## 15. 首版应真正实现的能力

当前希望 V1 覆盖：

- RivalHub Match 上下文接入；
- Waiting / Matchup；
- BP playback；
- Gameplay HUD；
- Radar；
- grenade / smoke / inferno 基础展示；
- KDA / ADR / round history 等直播临时统计；
- Halftime；
- Map Result；
- InterMap；
- Match Result；
- 单一 OBS Browser Source 的 Program；
- operator / debug surface；
- wrong-match diagnostics；
- offline cache / reconnect / recovery；
- record/replay/simulator；
- RivalHub live projection；
- result candidate。

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

## 17. 与 RivalHub #610 / #452 / DAK 的关系

当前理解：

- **RivalHub #610**：负责主仓 Match Runtime、canonical lifecycle/result、live ingest/read contract、reconciliation；其具体方案仍可能演进，本仓库不依赖其内部实现。
- **RivalHub #452**：负责公共 Match 页面最终怎样展示 live projection；Broadcast 不拥有公共站 UI。
- **RivalHub #613**：本仓库的来源 issue，负责本地 telemetry / Broadcast Runtime / Program。
- **DAK / RivalHub #268**：负责赛后 Demo evidence 与更高质量统计，不进入 Broadcast 的低延迟实时主循环。

最重要的产品边界：**Broadcast 产生 observation；RivalHub 决定 official truth。**
