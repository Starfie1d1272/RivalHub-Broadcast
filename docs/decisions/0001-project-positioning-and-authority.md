# ADR-0001：项目定位与权威边界

- 状态：**Accepted**

## 背景

赛事事实、低延迟本地运行态和赛后证据具有不同的更新频率、可靠性和责任边界。把它们放进同一数据库或同一状态模型会导致重复配置、身份漂移和错误 authority。

## 决策

### 独立本地制播运行时

RivalHub Broadcast 作为独立仓库和本地制播运行时演进，不作为 RivalHub Web 主仓中的页面模块。

### 赛事事实与实时观测分权

```text
赛事上下文提供方
  official / canonical tournament facts

Broadcast
  local realtime observation / presentation runtime

DAK / OCR / other evidence
  post-match evidence / reconciliation input
```

RivalHub 连接模式下，RivalHub 是官方赛事事实 authority。Standalone 模式使用本地比赛上下文，但不会让 Broadcast 的实时观测自动变成官方赛事事实。

### 不建立第二套赛事数据库

Broadcast 不维护独立的官方 Team / Player / Match / BP 数据库。连接 RivalHub 时只消费公开、版本化契约；不直连 Supabase / production tables，也不导入 RivalHub 内部页面或 domain 类型。

### Observation 与 official fact 分离

GSI、CSTV、accumulator 和本地 Runtime 产生 observation、projection 和 candidate evidence。是否形成 canonical lifecycle 或赛果，由对应赛事 authority 的 reconciliation policy 决定。

## 后果

- 同一赛事事实不需要在网站、HUD 和 OBS 工作流中重复维护；
- Broadcast 可以本地优先并独立演进；
- RivalHub 与 Broadcast 可以分别升级内部实现；
- telemetry、renderer、OBS 和赛事上下文来源都可以作为边缘适配器替换；
- 错场时可以在 integration boundary 默认拒绝，而不是污染官方数据。
