# 产品定义与需求

## 1. 定位

RivalHub Broadcast 是一套 **本地优先、开源、中文优先的 CS2 赛事制播工具**。它的目标不是只画一张 HUD，而是把比赛上下文、实时数据、节目画面、雷达、制作控制和观察辅助组织成一个完整的本地制播工作流。

长期产品目标包含两种运行方式：

```text
独立模式
  本地提供比赛上下文
        │
        └──→ Broadcast Runtime

RivalHub 连接模式
  RivalHub 提供 Match / Roster / Steam64 / BP / Schedule / Branding
        │
        └──→ Broadcast Runtime
```

RivalHub 是第一方、信息最完整的赛事上下文提供方，但不是运行 HUD、雷达、正式节目或观察辅助的前置条件。两种运行方式共享同一套 Runtime 和领域模型，只在赛事上下文来源上不同。

“独立模式”是产品方向，不等于当前已经补齐完整的本地比赛配置、安装引导和全部节目流程。当前能力完成度以代码和对应 milestone 验收为准。校园赛、社区赛和小型赛事是重要适用场景，不是第三种运行模式。

具体边界见 ADR-0006。

## 2. 产品原则

1. **本地优先。** 正式比赛的 HUD、雷达和基础节目流程不依赖持续公网连接。
2. **赛事事实只维护一次。** 连接 RivalHub 时，不在本地重新建立第二套 Team / Player / Match / BP 数据库。
3. **正式节目与辅助信息硬隔离。** Lookahead 未来信息永不进入正式 Program、OBS 正式输出或公开实时状态。
4. **同一套运行时支持完整节目。** Gameplay HUD 是核心场景，但不是产品全部。
5. **制作人员优先于架构术语。** 用户界面说明“发生了什么、该做什么”，不暴露内部枚举和实现名。
6. **可靠性优先于炫技。** 高频状态不积压，断流和错场默认安全降级。
7. **开源与可移植。** Core、Radar、Local Protocol 和 Lookahead 语义不绑定某个云端后台或某个第三方 HUD Manager。

## 3. 产品体验核心：制播工作区

传统 HUD 工作流通常把游戏、网页控制、雷达、诊断和辅助信息分散在多个窗口。RivalHub Broadcast 的长期产品形态是一套**私有制播工作区（Broadcast Workspace）**：

- CS2 正式节目画面保持最大视觉权重；
- 更易读的雷达、比赛状态和必要控制围绕主画面组织；
- 观察辅助信息放在私有区域，不污染正式节目；
- 制作控制和诊断在需要时可见，不长期占据注意力。

制播工作区是产品体验范式，不等于固定布局，也不要求某一种桌面框架。浏览器、OBS Browser Source、透明窗口或桌面容器只是不同 Host。

## 4. 现场用户

默认现场角色是**同一名解说兼 OB / 制作人员**。同一个人需要：

- 观看延迟的正式比赛时间轴；
- 手动切换 POV；
- 读取 HUD 与雷达；
- 在必要时控制场景和节目状态；
- 查看本机观察辅助；
- 处理断流、身份冲突和配置异常。

`/operator` 表示制作控制职责，不意味着产品必须存在另一名独立“导播用户”。

## 5. 正式节目制播

正式节目由 Program-safe 数据驱动，至少覆盖：

```text
Waiting / Matchup
BP / Veto Playback
Gameplay
Halftime
Map Result
Inter-map
Match Result
Break / Emergency
```

节目状态与 RivalHub 官方事实分离：播放 BP、切换节目场景或手动覆盖展示状态，不应修改赛事后台的 canonical BP、赛果或比赛生命周期。

BP / Veto 的节目播放只消费已经确认的赛事事实，并转换成 presentation timeline。制作人员至少应能够播放、暂停、上一步、下一步、重播和直接展示完整 BP；这些操作只改变节目呈现，不修改 canonical BP。

### 5.1 Gameplay HUD

HUD 至少能够表达：

- 地图、BO 格式、系列赛比分；
- 当前地图序号、已结束/当前/未开始/不再进行的地图、Pick/decider/start side；
- CT/T 当前比分、回合、阶段和时钟；
- 稳定的 5+5 active lineup；raw `allplayers` 中的 observer、coach、extra 或暂时缺失 entry 不直接决定 Player Rails；
- 选手的赛事身份与 `canonical | observed | unresolved` 证据状态；
- 存活状态；
- HP、护甲、头盔、拆弹器；
- 金钱、装备价值；
- 当前武器、弹药和手雷；
- K / A / D 等直播统计，以及由 Core 按 counted damage / counted rounds 计算的 `liveAdr` 与 `completedAdr`；前者可包含当前 eligible round，后者只包含已完成 counted rounds；
- C4 状态；
- 回合历史；
- 当前观察选手。

ProgramProjection 负责完成领域解释；React 组件只负责展示。例如选手存活状态由 Core 统一推导为 `alive | dead | unknown`，Renderer 不再次根据 HP 猜测。

系列赛比分、地图结果和当前地图绑定由 Broadcast 本地 `SeriesProgress` 统一维护。地图结束后本地立即推进，不等待 RivalHub 回写；进程重启使用有界 checkpoint 恢复已冻结事实。实际服务器地图与赛前计划不一致时，比赛 telemetry 仍可继续显示，但 Series 暂停绑定并等待 Operator 明确确认。Round History 恢复不完整时显示 `partial`，不由 Renderer 补猜缺失回合。

### 5.1.1 Gameplay HUD 自定义

Gameplay HUD 的第一版自定义面向现场制播人员，固定分为三层：

```text
HUD 预设
├─ HUD 布局：组件位置、显隐和允许的几何调整
├─ HUD 外观：品牌主色、面板风格和边角风格
└─ 组件设置：组件内部已经冻结的展示选项
```

正式节目只消费当前已启用的 HUD 预设；预设引用布局和外观，但“启用”不是布局或外观的独立操作。布局使用 1920×1080 logical pixels 的锚点与偏移保存，编辑器缩放不会改变持久化坐标；拖动可选择是否吸附到 10px 网格，数字编辑与持久化共同经过画布边界 canonicalizer；第一版只允许 Radar 做正方形调整，其它组件不开放任意尺寸编辑。

HUD 外观的用户控制只包括品牌主色、`实心 / 标准 / 轻量` 面板风格和 `方正 / 轻微圆角 / 圆润` 边角风格。CT/T、生命状态、危险、C4、字体、阴影、CSS、赛事品牌、队伍身份和动画属于设计系统、赛事上下文或 Renderer presentation state，不是普通用户设置。

HUD 控制台提供“HUD 预设”“HUD 布局”“HUD 外观”三个工作区，并提供可切换的测试场景与当前实时节目来源。三套草稿独立保留：切换工作区不会丢弃其它草稿，只有切换同类资源时才检查该类 dirty；切换预设若会覆盖未保存的布局或外观草稿则明确阻止。草稿、保存和启用相互独立：保存资源不会立即改变正式节目，只有重新启用预设才会更新正式节目使用的 on-air snapshot。编辑器预览与正式节目共享同一个 Gameplay HUD Renderer；编辑器辅助层承载辅助线、网格、选中框、拖动和尺寸控件，绝不进入正式节目。Current Live 在没有已接收初始状态时不可选；选中后若进入 stale、重连或协议错误仍保持来源选择但安全隐藏，新初始状态恢复后继续使用 Current Live，不回退到测试场景。

HUD 配置由本地 Companion 持久化，不以浏览器 `localStorage` 作为权威来源。custom 预设的 activation snapshot 是带独立版本边界的最后一次上屏内容；加载时严格校验其自身的布局、外观语义值和组件设置，不用当前版本 Theme recipe 重新计算后比较 bytes。Theme recipe 升级不会改变尚未重新启用的 custom on-air snapshot；重新启用才生成当前版本的新快照。built-in active reference 每次启动解析当前代码拥有的 built-in。配置损坏或暂时不可读时保留最后有效的启用快照，没有快照则使用内置默认；正式节目不会因为配置控制面短暂失败而切换到另一份比赛事实。

### 5.2 雷达

雷达是一等产品能力，至少支持：

- 选手位置、朝向和存活状态；
- 当前观察目标；
- C4；
- 手雷、烟雾、燃烧区域等可获得的道具信息；
- 多楼层地图；
- 选手编号、头像或自定义 marker；
- 尺寸、透明度和信息密度配置。

已发生轨迹与预测轨迹必须区分。没有可靠地图碰撞或物理依据时，不把简单外推包装成精确预测。

## 6. 观察辅助（Observer Assist）

观察辅助利用比正式节目更早的时间轴，把已经真实发生、但延迟 Program 尚未到达的事件转换成低认知负担的提示。

最小有用提示只回答：

```text
几秒后
谁 → 谁
```

位置只有在证据可靠时才显示。第一层产品不要求武器、未来雷达、叙事分类、推荐 POV、AI 排名或自动切镜。

### 6.1 Lookahead 不是预测

Lookahead 读取的是较早时间轴中已经发生的事件，不是对游戏未来进行机器学习预测。系统负责给制作人员反应时间，人继续拥有最终切镜和叙事判断。

### 6.2 提示提前量

提前量是人因参数，不是领域常量。过短来不及切镜，过长会增加“提前知道结果”的心理负担。因此实现必须允许配置，并以真实使用验证合适范围。

### 6.3 私有显示

观察辅助可以承载在：

- 独立透明置顶窗口；
- 制播工作区的私有区域；
- 调试用浏览器页面。

这些 Host 都消费 `ObserverAssistProjection`。它们不能与正式 Program 混在同一个安全边界内，更不能依赖 OBS crop 或窗口层级来“隐藏”未来信息。

## 7. 比赛上下文与身份

比赛上下文至少需要表达：

- 比赛、赛事、阶段、BO 格式和排期；
- 双方参赛实体；
- 名单、Steam64、选手显示信息；
- BP / veto；
- 地图和官方赛果；
- 解说、直播与品牌上下文。

身份匹配只把稳定赛事身份当作权威依据。Steam64 是运行时玩家匹配与 map-scoped stats 的稳定键；昵称、CT/T 和 observer slot 只作为显示或辅助证据。连接模式下，未知 Steam64 只产生 warning/degraded identity，不会因为稳定形成 5+5 active lineup 就隐藏真实上场选手；无法排除硬矛盾时才 fail closed 到中性 presentation。

身份状态至少区分：

```text
unbound
resolving
matched
degraded
mismatch
```

错场或明确身份冲突必须关闭错误品牌和自动上行资格，但仍允许中性本地观测与诊断继续工作。

## 8. 本地与离线行为

RivalHub 或其它赛事上下文提供方暂时不可达时：

- 已经加载且仍可信的比赛上下文可以继续使用；
- HUD / Radar / 本地场景继续运行；
- 上下文明确标记为过期；
- 不把过期上下文伪装成实时官方事实；
- 切换比赛失败时不能残留上一场的队名、Logo 或名单。

高影响 canonical 操作不能在离线时静默排队后自动执行。ReliableObservation 可以进入有界持久 outbox，但发送前必须重新验证会话、地图执行和身份上下文。

## 9. 用户界面与语言

正式产品界面默认中文。标题、按钮、状态、错误和操作提示不得直接显示内部枚举、类名或架构术语。

Debug 页面可以显示原始 JSON，但必须用中文说明数据属于哪一层、是否新鲜以及用户应如何判断异常。

开发者文档与诊断说明不适用“把所有英文词翻成中文”的规则；`RuntimeState`、`Projection → Renderer → Host`、`mapEpoch`、`Capture V1` 等 canonical term 应在需要精确指代时保留。术语规范见 [`terminology.md`](terminology.md)。

## 10. 明确不属于核心产品定义的事项

以下能力可以作为独立增强，但不构成 Broadcast 成立的前提：

- 自动导播或自动 TAKE；
- AI 叙事理解；
- 强制服务器安装插件；
- 通用电竞插件市场；
- 第二套赛事数据库；
- 把 Companion 暴露成公网数据平台；
- 依赖特定 HUD Manager 的内部协议；
- 依赖 RivalHub 内部数据库或页面源码。

产品扩展应优先通过明确的 adapter、capability interface 或独立 Projection 接入，而不是扩张一个万能状态对象。
