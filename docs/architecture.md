# 系统架构

本文只描述当前有效的架构边界。设计过程、实施顺序和一次性调查不进入本文。

## 1. 总体模型

RivalHub Broadcast 是一套本地优先、snapshot-driven 并带显式边沿转换的 CS2 制播 Runtime。

```text
赛事上下文                    实时数据
RivalHub / 本地配置           GSI / CSTV
       │                         │
       └───────┐         ┌───────┘
               ▼         ▼
              Adapters
                 │
                 ▼
        Shared Runtime Foundation
        ├─ continuity
        ├─ identity
        ├─ RuntimeState
        ├─ RuntimeTransition
        ├─ health / capability
        └─ bounded delivery
                 │
      ┌──────────┼───────────┐
      ▼          ▼           ▼
正式节目      制作控制      观察辅助
Program       Operator      Observer Assist
HUD / Radar   Debug         Lookahead cues
```

架构目标按优先级为：

1. 长时间运行不积压旧状态；
2. 官方赛事事实与本地 observation 严格分权；
3. Program 与 Assist 的数据边界默认安全；
4. 错场、断流、重连和重启可以明确降级；
5. 输入可 capture、可 replay、可测试；
6. Presentation 可以持续演进而不反向污染 Core。

## 2. Authority 与数据 ownership

### 2.1 赛事上下文提供方

RivalHub 连接模式下，RivalHub 拥有官方比赛、队伍、名单、BP、赛程和赛果等赛事事实。独立模式可以提供同形的本地比赛上下文，但不会改变 Runtime ownership。两种模式的长期产品边界见 ADR-0006。

Broadcast 不直接读取或写入 RivalHub 数据库，也不导入 RivalHub 页面或内部 domain 类型。

### 2.2 Broadcast

Broadcast 拥有：

- 实时数据 ingress 与 normalization；
- source continuity；
- 本地比赛绑定与 identity state；
- `RuntimeState` 与 `RuntimeTransition`；
- HUD、Radar、场景和制作控制所需 Projection；
- Lookahead alignment 与 Observer Assist；
- 本地 diagnostics、capture 与 replay；
- Local Protocol 与 delivery semantics。

### 2.3 赛后证据

DAK、OCR 或其它赛后来源属于 evidence / reconciliation 链，不进入低延迟 Program 主循环。

核心原则：

> Broadcast 可以产生 observation；official fact 由对应赛事 authority 决定。

## 3. Package ownership

```text
apps/companion
  本地服务与 composition root。
  组装 HTTP、GSI/CSTV、比赛上下文、Core、Local Protocol、Web、capture 与 qualification tooling。

apps/web
  Program、Operator 与 Debug 的 Web Renderer / Host。
  不拥有 RuntimeState，也不直接解释 Raw GSI。

packages/core
  纯 TypeScript Runtime domain。
  拥有 continuity、identity、RuntimeState、RuntimeTransition、accumulator、Projection。

packages/protocol
  Broadcast 自有的 Local Protocol、schema 和 acceptance rules。
  不拥有 RuntimeState 或业务状态机。

packages/telemetry-gsi
  Raw GSI parsing、source semantics、diagnostics 和 normalization。
  Raw GSI 类型不得越过本 package。

packages/telemetry-cstv
  CSTV GameEvent 读取与 parser-neutral observation。
  第三方 parser 类型不得越过本 package。

packages/rivalhub
  RivalHub 公开赛事上下文 contract 的 adapter。
  不拥有 Core / Radar / Lookahead domain。

packages/radar
  framework-neutral Radar domain：RadarFrame、world→radar、MapGeometryProvider、floor、marker / utility semantics。
  不拥有 React/SVG/Canvas/DOM，也不拥有 temporal interpolation、smoothing、autozoom/crop animation state。

packages/testkit
  capture 读取、replay、simulation、fault injection 和 deterministic assertions。
  不得成为 production runtime dependency。
```

依赖方向必须保持：

```text
adapter → Broadcast-owned domain → consumer Projection → Renderer / transport
```

禁止通过 deep import、TypeScript `paths` 或共享数据库绕过 ownership。

## 4. RuntimeState 与 Projection

Core 只有一份内部 `RuntimeState`，但它不是所有消费面的万能 payload。

概念上区分：

```text
RuntimeState
├─ match context
├─ program-safe runtime data
├─ assist-private runtime data
└─ operational health / incidents
```

不同消费面只通过自己的 Projection 获取数据：

```text
RuntimeState
├─ ProgramProjection
├─ RadarFrame
├─ OperatorProjection
├─ ObserverAssistProjection
└─ DebugProjection
```

规则：

- Projection 不能反向成为第二份 domain truth；
- Renderer 不读取整个 RuntimeState；
- ProgramProjection 不包含 Lookahead future 字段；
- DebugProjection 可以更宽，但不因此成为其它消费面的数据源；
- domain interpretation 在 Projection 结束，例如 `lifeState` 由 Core 统一推导，Renderer 不重复根据 HP 猜测。

## 5. 状态、转换、命令与事件

系统不使用一个万能 Event 类型承载所有语义。

### 高频 Snapshot

位置、HP、金钱、时钟等使用：

```text
latest-wins
bounded
droppable / supersedable
```

旧 snapshot 没有补发价值。

### RuntimeTransition

表达 Runtime 观察到的明确边沿，例如回合、地图执行或关键比赛状态变化。Transition 用于 accumulator、场景建议、diagnostics 和 ReliableObservation 派生。

### OperatorCommand

表示制作人员的显式操作，需要 request identity 与结果。它不是 telemetry event。

### ReliableObservation

由 `RuntimeTransition` 与 transition-time context 派生。它不是把当前 RuntimeState 序列化后换个名字。

### Incident

表示错场、数据过期、序列异常、slow consumer 等运行问题，只用于 health、Operator、diagnostics 和日志。

## 6. 连续性模型

至少区分四个维度：

```text
liveSessionId
  一场比赛与 Broadcast producer session 的绑定

producerInstanceId
  一次 Companion 运行实例

mapEpoch
  一张地图的一次实际执行

sourceGeneration / source sequence
  单个数据源自己的连接与读取连续性
```

不能用一个全局 `epoch` 或 `seq` 同时代表进程、比赛、地图和数据源。

Program GSI 与 Lookahead CSTV 是独立 source。任一 source generation 改变时，只使依赖该 source 的连续性证明失效；Lookahead 重连不会自动推进 Program 的 `mapEpoch`。

## 7. Program 与 Observer Assist 隔离

```text
Delayed Program source
  → Program-safe Runtime
  → ProgramProjection
  → Program Renderer
  → Program Host / OBS
```

```text
Lookahead source
  → Assist-private evidence
  → timeline alignment
  → ObserverAssistProjection
  → private Assist Renderer / Host
```

硬约束：

- Lookahead 没有 Program fallback 资格；
- Lookahead 故障只降级 Assist；
- Program 故障不会自动切换到 Lookahead；
- future information 不能先进入 Program 再靠 CSS、window z-order 或 OBS crop 隐藏；
- Program 与 Assist 可以有不同 Host，但数据安全由 Projection / schema 保证。

观察辅助可以由 transparent/topmost window 承载，也可以是 Broadcast Workspace 的私有区域；Host 技术不改变这一边界。

## 8. Radar 边界

`packages/radar` 拥有：

- `RadarFrame`；
- world → radar 坐标变换；
- `MapGeometryProvider`；
- floor selection；
- marker / utility semantics；
- 与时间无关、可确定性验证的几何和 domain 计算。

`apps/web` 的 Radar Renderer 拥有：

- React / SVG / Canvas / DOM；
- CSS 和 theme；
- `requestAnimationFrame` scheduling；
- temporal interpolation / smoothing；
- teleport / discontinuity reset；
- autozoom / crop 的 presentation state 与动画；
- OBS / browser Host 的 rendering adaptation。

地图几何作为 provider 输入 Radar domain。第三方地图包可以作为 reference 或 adapter source，但不能成为 Broadcast Radar contract 的 shape owner。

## 9. Local Protocol 与 delivery

本地 WebSocket 使用独立 channel：

```text
program
radar
operator
assist
```

每个 channel 有自己的 schema version、publisher 和 acceptance state。protocol version 与 channel schema version 分离，因此单个 payload 演进不要求整个 Local Protocol 同步升级。

连接建立后立即发送当前 baseline；断线重连重新取得 current baseline，不补发历史 snapshot。

每个 consumer 的发送状态保持常数级：

```text
in-flight
+ latest pending
```

新 snapshot 覆盖旧 pending snapshot。slow consumer 不能让内存 queue 随运行时间增长。

## 10. 本地安全

默认网络边界：

```text
bind = 127.0.0.1
```

非 loopback 监听必须显式开启，并配置精确 Origin allowlist。

凭据分离：

```text
GSI token
!= local control credential
!= RivalHub producer credential
```

Local WebSocket 校验 Origin 与 subprotocol；只读 snapshot channel 不接受浏览器业务消息。日志、fixture 和导出文件不得包含不必要的 token 或个人数据。

## 11. Capture、Replay 与测试

真实输入通过 production ingress 同时进入 capture 与 Runtime processing：

```text
Raw input
├─→ bounded Capture Recorder
└─→ production adapter → Runtime
```

capture 写盘失败不能阻塞 GSI request hot path。`packages/testkit` 消费保存的输入进行 replay、加速、drop、duplicate、reorder、disconnect 和 slow-consumer 测试。

真实 production evidence 优先于 synthetic fixture；fixture 用于可重复边界条件，不用于证明真实 CS2 source behavior。

## 12. 扩展规则

新增能力优先使用现有 owner：

- 新赛事上下文来源 → adapter；
- 新 CSTV / telemetry provider → source adapter；
- 新显示形态 → 现有 Projection 的新 Host / Renderer；
- 新节目数据 → 先判断是否属于 Core、Radar、Program 或 Assist；
- 新可靠上行 → 独立 reliable message，不把 snapshot 改成 FIFO。

只有出现第二个真实 consumer、真实 provider 或独立发行需求，并且现有边界造成明确摩擦时，才增加新的 public abstraction 或物理拆分。
