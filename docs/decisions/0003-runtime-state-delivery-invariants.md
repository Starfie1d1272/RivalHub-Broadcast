# ADR-0003：RuntimeState、Identity 与 Delivery Invariants

- 状态：**Accepted**

## 1. 单一 RuntimeState，按 consumer 投影

Core 维护一份内部事实模型：

```text
Normalized Telemetry
+ Match Context
+ Accumulators
+ Identity / Continuity
+ Presentation Control
        ↓
    RuntimeState
```

`RuntimeState` 不是 wire DTO，也不是 renderer 输入。不同消费面通过独立 projector / selector 获得所需模型。

## 2. Snapshot 与可靠消息分离

高频可覆盖状态使用 snapshot：

```text
latest-wins
bounded
droppable
```

边沿语义分为：

- `RuntimeTransition`：运行时边界变化；
- `OperatorCommand`：制作人员显式操作；
- `ReliableObservation`：需要可靠提交的高价值 observation；
- `Incident`：运行异常与降级。

禁止建设一个无差别永久保存所有东西的万能 EventJournal。

`ReliableObservation` 由 transition + transition-time context 派生，不能事后只从新的 current RuntimeState 逆推。

## 3. 连续性分层

至少区分：

```text
liveSessionId
producerInstanceId
mapEpoch
runtimeSeq
sourceGeneration / source-local sequence
```

进程重启、比赛会话、地图重置和单个 source reconnect 不能共用一个模糊 epoch。

## 4. Identity 是状态机

最小状态：

```text
unbound
resolving
matched
degraded
mismatch
```

Capability 由 identity、telemetry freshness 和 connection health 派生。`mismatch` 时关闭错误品牌和自动上行资格，但中性本地 presentation / diagnostics 可以继续。

## 5. 时间

- duration / timeout / staleness / interpolation 使用 monotonic clock；
- 跨机器协议和审计使用 UTC wall-clock timestamp。

## 6. 背压

每个 snapshot consumer 只允许常数级 pending state：

```text
sending current
+ pending latest
```

新快照覆盖旧 pending。慢 consumer 不阻塞其它 consumer，也不能让 queue / memory 随运行时间增长。

Reconnect 读取当前 baseline，不重放断线期间所有旧 snapshot。

## 7. 离线可靠性

高影响 canonical command 不得离线排队后自动执行。

`ReliableObservation` 可以进入有界、持久的 outbox，但 retry 前必须重新验证 session、map epoch、context revision、identity 和 credential scope。

## 8. Scene 与临时 cue

完整节目状态使用 `BaseScene`，短时反馈使用 `OverlayCue`。自动场景建议不能覆盖明确 manual override，也不能由单帧 partial telemetry 直接触发不稳定跳转。

Observer Assist future cue 不属于 Program OverlayCue。

## 9. Radar domain 与 renderer 分离

`packages/radar` 拥有 framework-neutral domain；Web 层拥有具体绘制技术和 frame scheduling。

## 10. 安全

默认 bind 为 `127.0.0.1`。GSI token、本地控制凭据和 RivalHub producer credential 必须分离。日志与 fixture 不保存不必要凭据和个人数据。
