# Telemetry 数据语义

本文定义 CS2 GSI 与 CSTV 输入在 Broadcast 中的 ownership、source semantics、标准化和证据要求。它不描述某个实施阶段，只记录当前有效规则。

## 1. 数据流

### GSI

```text
CS2 Raw GSI
    ↓
Companion HTTP ingress
    ├─→ 有界采集记录
    └─→ packages/telemetry-gsi
            ↓
      TelemetryObservation
            ↓
        packages/core
```

### CSTV

```text
CSTV / playcast
    ↓
packages/telemetry-cstv
  third-party parser binding
    ↓
GameEventObservation
    ↓
Core / source manager / Lookahead alignment
```

Raw GSI 和第三方 parser object 都必须在各自 adapter 边界内终止。

## 2. GSI observation 不是 patch

每个通过认证的 GSI payload 首先被解释为**当前 source observation**。

禁止全局规则：

```text
field absent
→ retain previous value
```

也禁止把：

```text
deepMerge(previous, current)
```

当成“当前真实 GSI state”。

真实 CS2 payload 会让某些只在特定阶段存在的字段自然消失。如果一律保留旧值，会制造上一回合 ``winner``、``bomb`` 等幽灵状态。

## 3. Block-specific semantics

当前适配器按 block 独立表达 coverage：

```text
present
absent
degraded
```

主要 block：

```text
map
round
phase_countdowns
player
allplayers
bomb
grenades
```

Absence 可能表示：

- 当前语义不存在；
- 当前 observer context 不提供该能力；
- source 暂时没有提供该 block；
- source/context 正在转换。

因此 ``absent`` 不等于 ``unchanged``。

对特定 block 如果需要跨帧连续性，必须有明确真实证据、局部实现和可测试诊断，不能扩张成通用 merge policy。

## 4. ``previously`` / ``added``

Raw GSI 中的 ``previously`` 与 ``added`` 只作为 change hint 和诊断证据：

- parser compatibility 调查；
- current-vs-previous diff 交叉验证；
- corpus 分析；
- 回归测试。

它们不是 Broadcast domain truth，也不能直接生成 ``RuntimeTransition``。

## 5. TelemetryObservation

``TelemetryObservation`` 是 Core-owned 输入契约，表达某一 source frame 经解释后的当前观测。

概念结构：

```text
TelemetryObservation
├─ receive
│  ├─ sequence
│  ├─ receivedAt
│  └─ receivedMonotonicMs
├─ source
├─ coverage
└─ telemetry
   ├─ map
   ├─ round
   ├─ phaseCountdowns
   ├─ player
   ├─ allPlayers
   ├─ bomb
   └─ grenades
```

它不包含：

- canonical RivalHub identity；
- official lifecycle / result；
- scene state；
- operator override；
- accumulator output；
- Lookahead future cue。

GSI-specific diagnostics 与 ``TelemetryObservation`` 并列返回，不塞进 Core domain。

## 6. GSI ingress

Companion 的 GSI ingress 只负责：

1. 接收 HTTP POST；
2. 验证 GSI token；
3. 应用 body / request limit；
4. 记录 UTC 与 monotonic 接收时间；
5. 将 accepted payload 交给采集记录器和 telemetry adapter；
6. 快速 ACK。

请求热路径不执行磁盘等待、RivalHub 网络调用、场景选择或重型业务逻辑。

默认监听本机回环地址。LAN 暴露不是 telemetry 默认行为。

## 7. 采集记录

生产采集记录器属于 Companion telemetry runtime，不属于 ``packages/testkit``。

基本要求：

- 写盘与 GSI 请求 ACK 解耦；
- 队列有明确 item 和 byte 上限；
- 队列溢出时记录降级，不无限积压；
- writer failure 不阻塞 runtime；
- shutdown 尝试有界收尾并明确 incomplete 状态；
- token 和不必要个人数据不进入可共享 fixture。

采集格式必须保留足够的接收时间、sequence 和完整性信息，使离线 verifier 能证明某个 runtime observation 对应真实 accepted frame。

## 8. Replay

Replay 必须重新经过正式 adapter：

```text
recorded raw input
→ production parser / normalizer
→ Core
→ projection
```

禁止测试直接伪造最终 RuntimeState 或 ProgramProjection 来替代 telemetry 语义验证。

``packages/testkit`` 可以对输入注入：

- packet drop；
- duplicate；
- reorder；
- jitter；
- disconnect / reconnect；
- 时间加速；
- slow consumer；
- source generation change。

## 9. CSTV GameEvent 边界

``packages/telemetry-cstv`` 是第三方 CSTV parser 的隔离层。

它负责：

- 读取 CSTV fragment；
- 维护 source-local generation / sequence / tick / health；
- 将支持的 GameEvent 立即复制为 Broadcast-owned scalar observation；
- 将 parser exception 转成受控 source diagnostic。

它不负责：

- 修改 RuntimeState；
- 推导 Program fallback；
- 建立第二套 event-sourcing；
- 渲染 HUD / Radar；
- 决定 canonical 比赛事实。

Program 与 Lookahead 具有独立 source-local continuity。Lookahead 重连必须让旧 timeline alignment 失效，但不能仅因为连接重建就改变 Program map epoch。

## 10. 时间与序列

本地 duration、timeout、staleness 和插值使用 monotonic clock。

跨进程、跨机器、报告和审计使用 UTC wall clock。

```text
monotonic → 过了多久
wall clock → 什么时候发生
```

序列值必须明确 scope，不能把 ingress sequence、runtime sequence、channel sequence 混成同一个编号。

## 11. 真实证据与 fixture

真实 Windows + CS2 / CSTV 输入用于证明 source behavior；synthetic fixture 用于可重复覆盖边界条件。

当真实 capture 与旧假设冲突时：

1. 保留原始 evidence；
2. 修正 source semantics；
3. 更新 adapter；
4. 从真实 capture 派生新的 sanitized fixture；
5. 删除已经不成立的兼容假设。

Reference corpus 应覆盖：

- warmup / freezetime / live / round end；
- halftime / side switch；
- map end / map change；
- disconnect / reconnect；
- source restart / generation change；
- Program 与 Lookahead 对齐；
- 长时间运行与慢消费者。

新增 capture 只为回答明确问题，不为了样本数量重复录制已经充分证明的场景。

## 12. 隐私与安全

采集、日志和 fixture 必须：

- 移除 GSI token；
- 避免保存不必要账户身份；
- 对 player identity 使用可重复的脱敏方式；
- 保留验证连续性需要的结构，不通过删字段破坏语义；
- 在进入仓库前执行 sanitizer 和完整性检查。
