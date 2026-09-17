# 系统架构

本文只描述当前有效的架构边界。设计过程、实施顺序和一次性调查不进入本文。

## 1. 总体模型

RivalHub Broadcast 是一套本地优先、快照驱动并带显式边沿转换的 CS2 制播运行时。

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
2. 官方赛事事实与本地观测严格分权；
3. Program 与 Assist 的数据边界默认安全；
4. 错场、断流、重连和重启可以明确降级；
5. 输入可采集、可重放、可测试；
6. 产品展示层可以持续演进而不反向污染 Core。

## 2. 权威与数据所有权

### 2.1 赛事上下文提供方

RivalHub 连接模式下，RivalHub 拥有官方比赛、队伍、名单、BP、赛程和赛果等赛事事实。独立模式可以提供同形的本地比赛上下文，但不会改变 Runtime 的 ownership。

Broadcast 不直接读取或写入 RivalHub 数据库，也不导入 RivalHub 页面或内部 domain 类型。

### 2.2 Broadcast

Broadcast 拥有：

- 实时数据接入与标准化；
- 数据源连续性；
- 本地比赛绑定与身份状态；
- ``RuntimeState`` 与 ``RuntimeTransition``；
- HUD、Radar、场景和制作控制所需投影；
- Lookahead 对齐与观察辅助；
- 本地诊断、采集记录与重放；
- 本地 WebSocket 协议与投递语义。

### 2.3 赛后证据

DAK、OCR 或其它赛后来源属于证据与复核链，不进入低延迟 Program 主循环。

核心原则：

> Broadcast 可以产生 observation；官方事实由对应赛事 authority 决定。

## 3. Package ownership

```text
apps/companion
  本地服务与组合根。
  组装 HTTP、GSI/CSTV、比赛上下文、Core、本地协议、网页、采集与验收工具。

apps/web
  Program、Operator 与 Debug 的网页渲染。
  不拥有 RuntimeState，也不直接解释 Raw GSI。

packages/core
  纯 TypeScript 运行时领域。
  拥有 continuity、identity、RuntimeState、RuntimeTransition、accumulator、projection。

packages/protocol
  Broadcast 自有的本地线协议、schema 和接收规则。
  不拥有 RuntimeState 或业务状态机。

packages/telemetry-gsi
  Raw GSI 解析、source semantics、诊断和标准化。
  Raw GSI 类型不得越过本 package。

packages/telemetry-cstv
  CSTV GameEvent 读取与 parser-neutral observation。
  第三方 parser 类型不得越过本 package。

packages/rivalhub
  RivalHub 公开赛事上下文契约的适配器。
  不拥有 Core / Radar / Lookahead domain。

packages/radar
  与前端框架无关的雷达领域：坐标变换、地图几何、楼层、marker、
  utility、插值和自动缩放数学。

packages/testkit
  采集读取、重放、模拟、故障注入和确定性断言。
  不得成为生产运行时依赖。
```

依赖方向必须保持：

```text
adapter → Broadcast-owned domain → consumer projection → renderer / transport
```

禁止通过 deep import、TypeScript ``paths`` 或共享数据库绕过 ownership。

## 4. RuntimeState 与投影

Core 只有一份内部 ``RuntimeState``，但它不是所有消费面的万能 payload。

概念上区分：

```text
RuntimeState
├─ match context
├─ program-safe runtime data
├─ assist-private runtime data
└─ operational health / incidents
```

不同消费面只通过自己的投影获取数据：

```text
RuntimeState
├─ ProgramProjection
├─ RadarFrame
├─ OperatorProjection
├─ ObserverAssistProjection
└─ DebugProjection
```

规则：

- 投影不能反向成为第二份 domain truth；
- Renderer 不读取整个 RuntimeState；
- Program 投影不包含 Lookahead future 字段；
- Debug 可以更宽，但不因此成为其它消费面的数据源；
- 领域解释在 projection 结束，例如 ``lifeState`` 由 Core 统一推导，渲染层不重复猜测。

## 5. 状态、转换、命令与事件

系统不使用一个万能 Event 类型承载所有语义。

### 高频快照

位置、HP、金钱、时钟等使用：

```text
只保留最新值
有界
允许覆盖旧值
```

旧快照没有补发价值。

### RuntimeTransition

表达 Runtime 观察到的明确边沿，例如回合、地图执行或关键比赛状态变化。转换用于 accumulator、场景建议、诊断和可靠 observation 派生。

### OperatorCommand

表示制作人员的显式操作，需要 request identity 与结果。它不是 telemetry event。

### ReliableObservation

由 ``RuntimeTransition`` 与转换发生时的必要上下文派生。它不是把当前 RuntimeState 序列化后换个名字。

### Incident

表示错场、数据过期、序列异常、慢消费者等运行问题，只用于健康状态、制作控制、诊断和日志。

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

不能用一个全局 ``epoch`` 或 ``seq`` 同时代表进程、比赛、地图和数据源。

Program GSI 与 Lookahead CSTV 是独立数据源。任一 source generation 改变时，只使依赖该数据源的连续性证明失效；Lookahead 重连不会自动推进 Program 的 ``mapEpoch``。

## 7. Program 与 Observer Assist 隔离

```text
Delayed Program source
  → Program-safe Runtime
  → ProgramProjection
  → Program renderer
  → 本机正式节目显示 / OBS
```

```text
Lookahead source
  → Assist-private evidence
  → timeline alignment
  → ObserverAssistProjection
  → 私有观察辅助
```

硬约束：

- Lookahead 没有 Program fallback 资格；
- Lookahead 故障只降级 Assist；
- Program 故障不会自动切换到 Lookahead；
- 未来信息不能先进入 Program 再靠 CSS、窗口层级或 OBS 裁剪隐藏；
- Program 与 Assist 可以有不同承载方式，但数据安全由 projection/schema 保证。

观察辅助可以是透明窗口，也可以是制播工作区的一部分；Host 技术不改变这一边界。

## 8. 雷达边界

``packages/radar`` 拥有：

- ``RadarFrame``；
- world → radar 坐标变换；
- ``MapGeometryProvider``；
- 多楼层选择；
- marker / utility 语义；
- 插值与自动缩放数学。

``apps/web`` 拥有：

- React / SVG / Canvas / DOM；
- CSS 和主题；
- ``requestAnimationFrame`` 调度；
- OBS / browser 的渲染适配。

地图几何作为 provider 输入 Radar。第三方地图包可以作为参考或适配来源，但不能成为 Broadcast Radar contract 的 shape owner。

## 9. 本地协议与投递

本地 WebSocket 使用独立 channel：

```text
program
radar
operator
assist
```

每个 channel 有自己的 schema 版本、发布器和接收状态。协议版本与 channel schema 版本分离，因此单个 payload 演进不要求整个本地协议同步升级。

连接建立后立即发送当前基线；断线重连重新取得当前基线，不补发历史快照。

每个消费者的发送状态保持常数级：

```text
正在发送
+ 最新待发
```

新快照覆盖旧待发快照。慢客户端不能让内存队列随运行时间增长。

## 10. 本地安全

默认网络边界：

```text
bind = 127.0.0.1
```

非本机回环监听必须显式开启，并配置精确 Origin 允许列表。

凭据分离：

```text
GSI token
!= 本地控制凭据
!= RivalHub producer credential
```

本地 WebSocket 校验 Origin 与子协议；只读快照 channel 不接受浏览器业务消息。日志、测试样例和导出文件不得包含不必要的 token 或个人数据。

## 11. 采集、重放与测试

真实输入通过正式 ingress 进入采集记录和运行时处理：

```text
Raw input
├─→ bounded capture recorder
└─→ production adapter → Runtime
```

采集写盘失败不能阻塞 GSI 请求热路径。``packages/testkit`` 消费保存的输入进行重放、加速、丢包、重复、乱序、断流和慢消费者测试。

真实生产证据优先于 synthetic fixture；fixture 用于可重复边界条件，不用于证明真实 CS2 source behavior。

## 12. 扩展规则

新增能力优先使用现有 owner：

- 新赛事上下文来源 → adapter；
- 新 CSTV / telemetry provider → source adapter；
- 新显示形态 → 现有 projection 的新 host / renderer；
- 新节目数据 → 先判断是否属于 Core、Radar、Program 或 Assist；
- 新可靠上行 → 独立可靠消息，不把 snapshot 改成 FIFO。

只有出现第二个真实消费者、真实 provider 或独立发行需求，并且现有边界造成明确摩擦时，才增加新的公共抽象或物理拆分。
