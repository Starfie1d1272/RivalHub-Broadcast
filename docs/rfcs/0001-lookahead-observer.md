# RFC-0001：Lookahead Observer / Observer Copilot

| 字段 | 值 |
| --- | --- |
| 状态 | Draft |
| 创建日期 | 2026-09-13 |
| RFC PR | 当前 PR |
| Roadmap | 基础 future kill cue 已进入 V1/P1；本 RFC 继续研究 acquisition、alignment、portability 与可选增强 |
| 主要领域 | telemetry、observer-assist UX、future observer tooling |
| 需要真实环境验证 | Windows + CS2 + CSTV + OBS；本地 relay 路径另需 playcast/断线恢复验证 |

## 2026-09-14 canonical reconciliation

RivalHub #613 与 ADR-0004 已重新按真实赛事工作流冻结基础边界：

- 当前是**单机、单人解说兼 OB**，不区分独立 Caster 与 Director/Operator 岗位；
- Delayed Program GOTV 是唯一正式节目输入；
- no-delay Lookahead GOTV 不给人直接观看，只供机器 headless 解析；
- Lookahead feed 不具备 Program fallback eligibility；
- 第一阶段 Observer Assist 的完成标准是**确定性的未来击杀提示**，而不是叙事理解或自动导播。

因此本 RFC 不再讨论“是否需要一个独立 Caster role”或“两个 Program source 如何 failover”。它继续保留并深化真正仍有价值的问题：如何获取 no-delay timeline、如何与 Delayed Program 对齐、如何稳定调度 cue、如何做跨 provider portability，以及未来是否值得增加 engagement aggregation / recommended focus / assisted TAKE。

## Summary

提出一个 **Lookahead Observer / Observer Copilot**：利用两个存在已知时间差的比赛时间轴，让 Broadcast 在节目侧 CS2 Observer 尚未看到某次击杀之前，先从较早时间轴读取**已经真实发生**的事件，再在本机 Observer Assist Overlay 中提前数秒提示同一个解说兼 OB，以便其手动切到相关 POV。

基础产品不是“AI 预测未来”，而是**利用制播延迟读取已经发生的未来**。第一阶段可以非常简单：`countdown + killer → victim + optional reliable location`。更复杂的 engagement/story 聚合、推荐 POV、自动切镜头、MulNX/VConsole actuator、自动 replay 和集锦都属于可选后续增强，不是基础 Assist 成立的前提。

本 RFC 推荐第一阶段使用 **双 CSTV 时间轴**验证产品与时间轴模型，并将其视为当前目标 Perfect World 赛事环境中的**首选 production path**：现有实际使用已经观察到同场比赛可同时获得无延迟与自定义延迟 GOTV，且 endpoint 形式高度规则。与此同时，仍保留 **单 CSTV + 本地 buffered relay** 作为后续面向缺少双流 provider 的可移植部署路径。两种方案应共享上层 lookahead evidence / alignment / cue scheduling 语义，不能让某一种传输实现成为产品语义的 owner。

## Context / Problem / Motivation

当前 Major 由**同一个解说兼 OB**负责解说和手动切镜。人工 Observer 的核心困难很具体：不知道节目时间轴十秒后谁会击杀谁，往往等 kill feed 出现后再切已经太晚。

现有公开工具大致分成三类：

1. Observer HUD：增强**当前**比赛状态的可读性；
2. Auto Observer：依据当前状态预测 action，并直接控制 spectator；
3. Replay / demo tooling：事后或延迟地寻找高光并自动录制。

这里存在一个更简单的产品空间：如果赛事本来就有 CSTV 延迟，或者可以人为构造两个时间轴，那么系统不需要预测。较早时间轴上已经发生的击杀，对较晚节目时间轴而言就是确定的“未来”。机器只需要把这个时间优势转换成低干扰提示，镜头叙事判断继续交给人。

ADR-0004 已把基础 Observer Assist、Program/Assist non-leak 与 no Lookahead→Program fallback 冻结为 V1 边界。本 RFC 重点研究**如何可靠地获得和对齐 future evidence，以及基础 kill cue 之上的增强是否值得做**。

## User benefit

第一版最小但完整的用户体验可以只是：

```text
NEXT KILL · +9.8s
T #7 → CT #3
A SITE
```

如果位置无法可靠获得，则退化为：

```text
NEXT KILL · +9.8s
T #7 → CT #3
```

同一个解说兼 OB 看到提示后，自己决定是否切到 killer、victim 或其它 POV。

更丰富的后续模式可以增加：

```text
Recommended focus
1. T #7
2. CT #3
```

或者将短时间内多个 kill 聚合成一个 engagement。但这些属于 enhancement，不是第一版成功的必要条件。

## Goals

1. 让解说兼 OB 在下一次关键击杀到达 Program 前获得稳定、低认知负担的 future kill cue。
2. 第一阶段 cue 至少表达 countdown、killer、victim，以及可靠时的 location。
3. 只运行一个真正渲染画面的 CS2 observer client；no-delay 时间轴应尽量 headless 消费。
4. 用比赛 tick / map / session 等 timeline 信息对齐，而不是只依赖 wall-clock sleep。
5. 把产品语义与 CSTV transport、parser、MulNX/VConsole 等具体实现解耦。
6. 首先验证真实赛事条件下 cue 的 lead time、稳定性和 usefulness，再决定是否需要更复杂的 cue aggregation / recommended focus。
7. 允许纯提示模式成为最终形态，而不是把它定义为“不完整的 Auto Director”。
8. 保留未来从同一套 lookahead evidence 派生 assisted TAKE、replay capture、halftime/post-match highlight 等能力的空间，但不让这些未来能力污染当前基础设计。

## Non-goals

本 RFC **不**要求第一阶段实现：

- 训练 AI / LLM / reinforcement-learning camera model；
- full-auto observer；
- 自动 TAKE；
- 佯攻 / 主攻识别；
- engagement/story classification 作为基础依赖；
- 复杂 importance ranking；
- 第二个 CS2 renderer、低帧率虚拟机或双 GPU；
- 要求比赛服务器安装 MetaMod / CounterStrikeSharp；
- 将 MulNX 变成 Broadcast core dependency；
- OBS Replay Buffer、自动集锦或 cinematic replay；
- 第一阶段解决所有 CSTV provider / 平台部署差异。

## Product principle：先做确定性 kill cue，再决定是否需要叙事层

第一阶段 UI 可以按 `player_death` 事件工作，因为它解决的是一个已经很明确的业务问题：**提前告诉人下一次真实击杀是谁杀谁。**

基础策略可以很轻：

- 按 target tick 调度；
- 对完全重复事件去重；
- 必要时加最小 cooldown / overlap handling；
- 人保留最终切镜判断。

只有真实比赛使用证明“连续 kill 太多导致 cue spam”“同一波交火需要更高层摘要”之后，才值得升级到 `EngagementCandidate` / story，例如：

```text
A execute
4T vs 2CT
3 observed future combat events
bomb plant follows
importance: high
```

此时系统可以：

- 只提示更高优先级 engagement；
- 显示主/次两个 cue，但不强迫切换；
- 价值接近时保持当前故事，不制造无意义抢镜。

也就是说：**engagement aggregation 是可能的第二层产品，不是第一层 kill cue 的前置条件。**

## Proposed architecture

基础产品模型：

```text
No-delay Lookahead feed
        ↓
Timeline adapter / headless parser
        ↓
Bounded lookahead evidence
        ↓
Timeline alignment
        ↓
Kill-cue scheduler
        ↓
ObserverAssistProjection
        ↓
Topmost transparent Assist Overlay
        ↓
Human commentator / observer
        ↓
Delayed CS2 observer → OBS → Program
```

未来增强可以在 `Bounded lookahead evidence` 之上增加：

```text
Event aggregation
→ Engagement / cue policy
→ optional recommended focus
```

关键原则：

- **只有 Delayed Program lane 必须渲染 CS2。** Lookahead lane 的首选是 CSTV/playcast headless parser，而不是第二个隐藏/低 FPS CS2。
- lookahead evidence / alignment 是 `RuntimeState` 的派生输入/状态，不建立第二份长期 `FutureTimelineState` 作为 domain truth。
- 第三方 parser 类型不得泄露为 canonical protocol。
- Cue 的执行时间由 no-delay / delayed timeline 的实际差值推导，不把“10 秒”或“120 秒”写死。
- 如果未来增加自动 TAKE，只能作为独立 `CameraActuator` capability；Advisor 不依赖 actuator 才能成立。
- no-delay feed 永远没有 Program eligibility；本 RFC 不设计 Lookahead→Program fallback。

### Conceptual model

本 RFC 不冻结最终代码 symbol，但实现应至少能表达以下概念：

```text
SourceTimeline
- session / match identity
- map / epoch
- tick
- observedAt
- source role

TimelineAlignment
- lookahead tick
- program tick
- estimated gap
- health / confidence

FutureKillCue
- event tick
- target display tick / window
- killer
- victim
- optional reliable location
- desired lead time
- evidence / source
```

更复杂的 `FutureCue / EngagementCandidate / recommended focus` 可以在基础模型验证后追加。

必须能区分：

- event 真正发生的 match tick；
- lookahead consumer 收到它的 wall-clock 时间；
- delayed renderer 当前所在的 match tick；
- cue 应展示的本地时间。

## Option A — Dual CSTV timelines

### Model

赛事平台或服务器提供两条属于同一场比赛、延迟不同的 CSTV/GOTV 时间轴：

```text
NO-DELAY LOOKAHEAD
    ↓
headless parser
    ↓
future event/state evidence
    ↓
hold until desired lead window
    ↓
Observer Assist cue

DELAYED PROGRAM
    ↓
CS2 observer
    ↓
OBS / Program
```

两条流不需要只差 10 秒。假设 Lookahead 接近实时，而 Program 延迟约 120 秒，系统仍然可以在 future event 到达后等待约 `effectiveGap - desiredLead`，让 cue 在 Program timeline 对应事件前 5–15 秒出现。

### Observed target deployment：Perfect World

在当前实际使用的 Perfect World 赛事后台中，已经观察到同一场比赛同时提供：

- 一条无延迟 GOTV；
- 一条用户配置约 120 秒延迟的 GOTV；
- 两个连接 endpoint 的主体相同，实际示例中仅末尾标识相邻，例如无延迟流末尾为 `...5`，对应延迟流末尾为 `...6`。

这使 Dual CSTV 对当前 RivalHub/NJU 赛事场景的性质发生变化：它不再只是“需要赛事平台额外配合才能尝试”的假设，而是**当前目标部署环境已经具备的基础能力**。如果该行为在实际比赛中稳定，Lookahead Observer 不需要要求平台新增 110 秒或其他专用延迟流；已有 `0s + 120s` 两条时间轴即可由 Broadcast 在 no-delay event 到达后等待 `effectiveGap - desiredLead`，例如在 120 秒节目时间轴上的事件发生前约 10 秒展示 cue。

但 endpoint 的相邻后缀只能作为 **discovery heuristic**，不能成为 identity 或安全真相。即使 Broadcast 未来自动从已知 endpoint 推导候选相邻 endpoint，也必须在启用 future cue 前验证：

```text
same match/session
same map / map epoch
compatible tick timeline
measured effective gap is healthy
```

任何推导失败、认证失败、wrong-match、stale-map 或 alignment 不可信都必须 fail closed；不得因为 URL “看起来只差 1”就默认两条流属于同一比赛。

### Advantages

- **最少的协议 ownership**：Broadcast 不需要负责 CSTV 延迟 buffer 的正确性。
- **最干净的 PoC**：能独立验证 future kill cue 是否有产品价值，不会把 relay bug 与产品假设混在一起。
- **一个 CS2 renderer**：Lookahead lane headless parse，不增加主要 GPU 渲染负担。
- **当前目标环境几乎零新增制播基础设施**：Perfect World 已观察到同场比赛的实时/延迟双 GOTV，不需要第二台机器、第二个 CS2 或新增 server plugin。
- **生产先例强**：当前 Valve Major supplemental rulebook 仍要求 `tv_enable1 1`，并允许配置 `tv_delay` / `tv_delay1`；双 SourceTV timeline 是赛事基础设施原生支持的方向。
- 断线恢复时，Delayed Program 主要由 provider/server 维护；Broadcast 只需重新估计 alignment 并在不健康时 fail closed。

### Drawbacks

- 依赖赛事 provider / server 能提供两条可独立消费的时间轴；Perfect World 当前实测情况不能自动外推到其他 provider。
- 第三方平台是否允许自定义两路延迟、URL 形式和认证方式需要逐个验证。
- Perfect World 观察到的“相邻 endpoint 标识”属于 deployment convention，而不是 Broadcast 可以依赖的协议 invariant。
- 如果只能得到一条流，该模式无法单独部署。
- 两路网络路径可能有不同 jitter，因此仍然不能把配置值当成实际 gap。

### Recommendation

**作为第一 PoC，并作为当前 Perfect World 目标赛事环境的首选 production path。**

这不只是因为它能把产品、时间轴和 transport 风险分离得最好；在当前真实部署环境里，双流前提已经存在，因此相比 local relay 还同时拥有更低的新增工程成本和更小的运维责任。

这仍不意味着它是最终唯一架构：对没有双 CSTV 的 provider，Option B 继续作为 portability path；上层产品逻辑不得绑定 Perfect World endpoint convention。

## Option B — Single CSTV + local buffered relay

### Model

只获取一条 upstream CSTV/playcast：

```text
                   ┌→ immediate parser → lookahead evidence
Upstream CSTV ─────┤
                   └→ local fragment buffer / relay
                              ↓
                       delayed playcast
                              ↓
                         CS2 observer
```

CSTV HTTP broadcast 使用 `start` / `full` / `delta` fragments 与 `/sync` 协商。现有 relay 实现已经证明可以通过让 `/sync` 选择较早的 FULL fragment 来制造 live-edge offset；因此该方向不是“重新发明网络协议”，而是一个需要正确维护 fragment history、sync 与 recovery 的 local relay。

### Evidence

- Valve Developer Community 的 broadcast 协议说明允许 viewer/relay 从已有 FULL fragment 开始同步。
- `FlowingSPDG/cstv-cloudflare` 已提供 CSTV relay，并通过 `SYNC_FRAGMENT_DELAY` 让默认 `/sync` 落后于最新 FULL fragment。
- `gotv-plus-go` / playcast 生态存在从指定 fragment 启动的实现先例。

这些证据证明**人为 fragment offset 可行**，但不等于已经证明我们要求的长期本地赛事运行、断线重连和固定 lookahead invariant 无风险。

### Advantages

- **部署最漂亮**：理论上只要求一条 CSTV upstream。
- 不依赖第三方平台额外提供第二条延迟流。
- Lookahead 与 Program 来自同一 upstream，理论上更容易建立单一 canonical source identity。
- 可以把期望 lookahead 变成 Broadcast-controlled configuration。

### Drawbacks

Broadcast 会新增一整层 production responsibility：

- fragment retention / eviction；
- `/sync` 选择；
- `full` / `delta` 连续性；
- map change；
- token redirect；
- upstream gap；
- late join；
- CS2 playcast reconnect；
- 205 reset / retry semantics；
- 重新同步时不能突然跳回 live edge；
- 本地 cache / relay 的内存、磁盘和生命周期。

最危险的 failure mode 不是“relay 崩了”，而是**看似仍在播放，但 Lookahead/Program gap 已悄悄变化**，导致 future cue 变成 late cue 或错误 cue。因此任何 relay 路径都必须暴露 timeline health，并在 alignment 不可信时关闭提示，而不是继续猜。

### Recommendation

**Promising portability path，第一轮不作为产品 PoC 前置条件。**

Dual CSTV 验证通过后，再做一个独立 protocol PoC，只证明：同一 upstream 下 parser 位于 T，而 CS2 能在整张地图、断线/重连、换图条件下长期稳定保持 T−Δ。

在当前 Perfect World 赛事环境已经存在可用双 GOTV 的前提下，local relay 的价值主要转为**跨 provider 可移植性与单流部署兼容**，而不是当前赛事上线 Lookahead Observer 的 blocking dependency。

## Why not a second low-FPS / hidden CS2?

理论上可以让 Lookahead lane 使用第二个低分辨率、低 FPS 或隐藏 CS2，再通过 GSI/注入获取状态。但这会引入第二个 Source 2 renderer、Steam/client/session、显存/CPU、窗口捕获与版本兼容问题，而且没有产品必要性。

只要 CSTV parser 能拿到所需 game events/entity state，**单机目标应该是“一份 headless data consumer + 一份真正 CS2 renderer”**，而不是在一台赛事机里强塞两个游戏实例。

## Why not server plugin first?

CounterStrikeSharp / MatchZy 可以提供可靠 server-side game events，但会把基础产品能力绑定到 MetaMod/plugin 安装和 CS2 更新兼容性。它们可以成为 future enhanced telemetry provider，却不应成为 Lookahead Observer 的基础前提。

## Why not full auto first?

自动 Observer 的困难不是“能否发送切 POV 命令”，而是 camera scheduling：

- 多点同时交火；
- 进点时大量事件聚集；
- 是否应该 hold 当前故事；
- 什么时候允许更高价值事件 interrupt；
- 解说正在讲什么；
- 玩家 POV 的连续性与观众空间理解。

这些问题都是真实的，但**第一版 kill cue 不需要先解决它们**。人仍然掌握镜头叙事权。只有基础提示经过真实比赛使用后，才决定是否需要更复杂的 assisted TAKE / auto observer。

## Prior art / evidence

以下项目用于证明能力边界，不代表直接复制代码：

| 项目 / 来源 | 证明什么 | 不能直接推出什么 |
| --- | --- | --- |
| Valve CS Major supplemental rulebook | 当前 CS2 赛事配置仍支持第二 SourceTV 与独立 `tv_delay1` | 第三方赛事平台一定向我们暴露两条可控 URL |
| DemoFile.Net / demoinfocs | CSTV / HTTP broadcast 可以 headless 解析 game events/entity state | 已经替 Broadcast 解决时间轴健康与产品 cue |
| LHM Scout AI / Replay | live observer automation、delayed replay 属于真实制播产品类别 | 其闭源决策模型可直接复用 |
| yaibo | 单机 GSI + spectator control 的自动 Observer 产品方向存在 | Lookahead cue 与其模型相同 |
| CS2-Insight-Agent | Demo → event → spectator control → OBS record 的自动链路可行 | 适合 low-latency live director |
| MulNX | observer/camera/GOTV 与外部控制可以形成强 actuator/provider | 应成为 Broadcast core dependency |
| cstv-cloudflare / gotv-plus-go | CSTV fragment relay 与人为 sync offset 有实现先例 | 本地固定延迟、断线恢复已达到我们的 production acceptance |

公开参考：

- Valve Major supplemental rulebook: <https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/main/major-supplemental-rulebook.md>
- Valve broadcast protocol notes: <https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Broadcast>
- DemoFile.Net: <https://github.com/saul/demofile-net>
- cstv-cloudflare: <https://github.com/FlowingSPDG/cstv-cloudflare>
- MulNX: <https://github.com/Co1Swet/MulNX_CS2>
- CS2-Insight-Agent: <https://github.com/DrEAmSs59/CS2-insight-agent>
- LHM Scout AI: <https://lhm.gg/features/scout-ai>
- yaibo: <https://yaibo.gg/>

## Observer Assist UX principles

1. Assist 是**本机私有显示层**，不是 Program overlay；观众不应该看到未来信息。
2. 第一版默认 cue 低认知负担：countdown、killer、victim，以及可靠时的 location。
3. Cue 有明确 stale/health 语义；alignment degraded 时必须关闭或显式降级，不能继续显示“看似精确”的倒计时。
4. 不要求第一版理解 execute/clutch/故事线；复杂信息密度是后续 enhancement。
5. 如果未来增加 recommendation，应允许关闭，并始终保留人的最终切镜权。

## Timeline alignment and reliability

这是本 RFC 最核心的工程风险。

### Canonical identity

Lookahead 与 Program 必须证明属于同一个：

```text
match / session
map / map epoch
round/tick timeline
```

wrong-match / stale-map 必须 fail closed。

Provider-specific endpoint naming、端口号或末尾标识只能帮助**发现候选 timeline**，不能替代 canonical identity。尤其是当前 Perfect World 观察到的相邻末尾标识，未来可以用于 UX 上减少手工配置，但必须在完成 timeline identity/alignment validation 后才能启用 cue。

### Tick-first alignment

系统应持续估计：

```text
lookaheadTick
programTick
effectiveGap
alignmentHealth
```

Wall clock 用于观测延迟、日志和 UI scheduling，但不能成为唯一比赛真相。网络 jitter 影响“什么时候收到 fragment”，不应改变“事件发生在哪个 match tick”。

### Reconnect

任何 reconnect、map change、source restart 后都必须重新建立 alignment。未重新建立可信关系前不发 future cue。

## Performance

目标是避免第二 CS2 renderer，因此主要新增负载来自：

- CSTV parser；
- bounded lookahead evidence/history；
- alignment / cue scheduler；
- ObserverAssistProjection / overlay。

只有以后增加 engagement aggregation 时才引入更复杂的 event/state aggregation 成本。

不能只凭“headless 应该很轻”做假设。PoC 必须记录赛事机上的 CPU、内存、网络和对 CS2/OBS frame stability 的影响。Local relay 路径还需要单独记录 fragment cache 成本。

## Security / privacy / operations

- CSTV/playcast URL、token、origin auth 等可能属于敏感赛事凭据，不进入公开 fixture/log。
- Future cue 只进入 Observer Assist；不得误投到 `/program` 或公共 BroadcastLiveSnapshot。
- no-delay Lookahead feed 不具备 Program eligibility，不设计 failover 到正式节目。
- Assist Overlay 如果是 topmost/click-through window，必须验证官方 OBS capture path 不会把它误录进去。
- Local relay 如监听网络端口，应默认 localhost，并在真正产品化前纳入 security/operations 文档。
- 第三方 parser/relay/MulNX 的许可证在任何代码级复用前单独确认；本 RFC 只确认架构与 prior art，不批准依赖。

## Validation plan

### Phase 0 — Capture facts, no feature

先确认真实赛事环境：

- 能获得哪些 CSTV URL / connection forms；
- 已观察到的 Perfect World 实时/延迟双 GOTV 与相邻末尾标识规律，是否跨多场比赛稳定成立；
- 相邻 endpoint 是否只是 discovery convention，是否存在缺号、认证差异或复用导致误配的情况；
- 两条 timeline 是否确属同一 match/session；
- 配置 delay 与实际 effective gap；
- 是否可以 headless parse；
- map change / reconnect 后 identity 如何变化。

### Phase 1 — Dual-timeline offline / debug PoC

不做正式 UX，只记录：

- lookahead event tick；
- Program current tick；
- estimated gap；
- desired cue tick；
- 实际 cue lead time。

用完整地图而不是短 demo 验证 alignment drift。

### Phase 2 — Minimal Observer Assist UX PoC

在本机 Assist surface 展示：

```text
countdown
killer → victim
optional reliable location
```

人工解说兼 OB 对照真实比赛评价：

- 是否足够提前；
- kill identity 是否正确；
- location 如果展示是否可靠；
- 是否实际减少 missed opening / late camera switch；
- 连续击杀时是否产生无法接受的 cue spam；
- overlay 是否干扰操作；
- overlay 是否完全不进入 OBS Program capture。

只有这里暴露出实际问题，才进入 engagement aggregation / richer recommendation 的产品实验。

### Phase 3 — Optional richer cue policy

如果基础 kill cue 证明有用，但 event spam / 多点同时交火成为真实痛点，再验证：

- kill grouping / EngagementCandidate；
- priority / hold / cooldown；
- optional recommended focus；
- 对 Observer usefulness 的增量收益。

### Phase 4 — Local relay protocol PoC

只有 Dual CSTV 产品路径证明有价值且存在跨 provider 需求后才做。验证：

- single upstream；
- immediate parser；
- delayed CS2 consumer；
- full-map stable Δ；
- upstream 短断、CS2 reconnect、map change；
- 不发生 silent jump-to-live-edge。

### Optional future — Assisted TAKE

若人工 cue 已经稳定，再定义独立 RFC/ADR 讨论：

```text
CameraActuator
├─ MulNX
├─ VConsole / supported control path
└─ Manual-only
```

Advisor 本身不得依赖该阶段。

## Success metrics

基础 PoC 不预先伪造未经真实数据验证的阈值；至少产出：

- cue lead-time distribution；
- alignment error / drift；
- alignment unhealthy / disabled time；
- future kill identity correctness；
- optional location correctness；
- duplicate/overlapping cue rate；
- cue spam / nuisance rate；
- Observer 主观 usefulness；
- missed opening / late switch 的变化；
- parser/relay CPU、memory、network overhead；
- CS2/OBS frame-time regression；
- Assist→Program leak = 0。

如果后续测试 richer cue policy，再追加 important engagement coverage、recommendation ignore/override rate 等指标。

如果系统不能稳定知道自己是否与 Program timeline 对齐，即使平均 cue 很准也不应进入 production。

## Risks and mitigations

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Provider 不提供双流 | A 无法部署 | 当前 Perfect World 目标环境已有双流观察证据；其他 provider 使用 B local relay 作为 portability path |
| Provider endpoint heuristic 误配 | wrong-match / future cue 严重错误 | 末尾 `+1` 等规则只做 discovery；same match/map/tick/alignment 验证后才启用 |
| Lookahead/Program drift | cue 变早/变晚 | tick-first continuous alignment + health + fail closed |
| 连续 kill cue 太多 | Observer 注意力下降 | 第一阶段最小 dedupe/cooldown；若真实比赛仍有问题再做 engagement aggregation |
| 两处同时交火 | 单个 kill cue 不能完整表达叙事 | 人保留最终判断；只有证明确有需要才增加 grouping/priority |
| Parser 版本受 CS2 更新影响 | telemetry 中断 | adapter boundary、record/replay fixtures、版本验收 |
| Local relay reconnect 跳回 live | future relation 被破坏 | relay 独立 protocol PoC；断线后重新建立 alignment 前关闭 cue |
| Future 信息泄露到 Program | 破坏直播公平/观看体验 | Assist-only projection + official OBS preset + real capture non-leak acceptance |
| 过早做自动化 | 工作量与风险失控 | 基础 kill cue 本身是完整产品；actuator/AI 独立后置 |

## Alternatives considered

### A. 当前 GSI + AI prediction

优点是只需一个时间轴；缺点是必须真正预测未来，而且错判不可避免。若已经拥有制播延迟，使用确定的 future timeline 信息更直接。因此不是首选，但可作为没有 CSTV lookahead 时的独立产品方向。

### B. Server plugin + delayed renderer

事件最可靠，但增加 server-side deployment/compatibility burden。适合作为增强 provider，不作为基础要求。

### C. 第二个 CS2 client / VM

实现概念简单，但资源与运维成本明显更高，违背单机赛事环境目标。在 headless CSTV parser 被证伪前不采用。

### D. Full-auto observer

潜在价值高，但 camera scheduling 是独立复杂问题，而且不是基础 future kill cue 成功的必要条件。后续单独 RFC。

### E. 不做

继续依赖解说兼 OB 自行阅读当前 radar/kill feed。实现成本最低，但无法利用赛事本来存在的时间延迟这一独特信息优势。

## Rollout / ownership boundaries

ADR-0004 已冻结基础 Program/Assist boundary 与 V1 minimal kill cue 的产品层级。本 RFC 负责尚未完全冻结的 acquisition / alignment / portability / richer cue 设计。

若本 RFC 最终 Accepted：

1. **基础 kill cue 不再被视为 Future/Post-v1；** 它按当前 Roadmap 的 V1/P1 Observer Assist 路径推进。
2. engagement/story classification、recommended focus、auto TAKE、replay automation 等增强不会因本 RFC 被接受而自动进入当前 milestone。
3. PoC 应尽量复用 M1 的 recorder/replay/session/time primitives，而不是创建第二套 runtime。
4. Lookahead evidence / alignment 作为 Runtime 的派生能力，不建立第二份 FutureTimeline domain truth。
5. 真正 implementation Issue 按 `CONTRIBUTING.md` 补全 Objective、Scope、Non-goals、tests、platform gate 和 real-environment acceptance。
6. MulNX 等第三方只通过 adapter/capability 接缝进入，不拥有 cue policy 或 Broadcast RuntimeState。
7. Perfect World endpoint 自动发现如果产品化，只能属于 provider adapter / discovery 层，不能成为 core timeline identity 规则。

## Open questions

在 RFC merge 前不一定全部解决，但必须在对应实现阶段显式关闭：

1. 当前已观察到的 Perfect World 双 GOTV 与相邻 endpoint 规律，在多少场比赛/不同赛事配置下稳定？认证和 map change 后是否仍一致？
2. 哪个 headless parser 在当前 CS2 build 下最适合作为 PoC？是否需要自己补 live broadcast adapter？
3. Lookahead 与 Program 的稳定 identity/tick 对齐需要哪些字段？
4. 对人工 Observer 最有效的默认 desired lead 是多少？10 秒是否合适，还是应该可配置？
5. 基础 `player_death` cue 在真实比赛里是否已经足够？只有出现哪些具体痛点才值得引入 engagement aggregation？
6. Local relay 是否能在真实 CS2 playcast reconnect / map change 下维持固定 offset？
7. Future kill cue 是否需要音频提示，还是透明视觉提示足够？
8. topmost/click-through overlay 在 Windows + OBS 的最佳实现方式是什么，怎样保证不被官方 Program capture 捕获？
9. 如果未来加入 MulNX actuator，manual input takeover 如何检测与仲裁？

## Decision requested

本 RFC 当前希望评审的是以下方向是否成立：

1. **承认基础 future kill cue 是独立、完整的产品能力；不要求先做叙事理解或 Auto Director。**
2. **采用 timeline-provider abstraction：上层不绑定 dual stream 或 local relay。**
3. **第一验证路径选择 Dual CSTV，并在当前 Perfect World 目标赛事环境中将其视为首选 production path；Local buffered relay 主要作为跨 provider portability PoC。**
4. **坚持一个 CS2 renderer；no-delay lane 优先 headless parse。**
5. **Lookahead feed 永不具备 Program fallback eligibility。**
6. **任何 production cue 必须基于可观测的 timeline alignment health，并在不可信时 fail closed。**
7. **任何 provider endpoint 自动推导都只能用于 discovery，不能替代 match/map/tick identity validation。**
8. **engagement/story/recommended focus 等复杂 cue policy 作为真实使用后的增强层，而不是基础 acceptance。**

如果这些方向获得认可，下一步应优先建立一个范围很小的 Dual CSTV alignment + future kill cue PoC Issue；更复杂的叙事层等基础数据回来后再决定。
