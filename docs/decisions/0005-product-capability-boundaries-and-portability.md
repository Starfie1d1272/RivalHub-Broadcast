# ADR-0005：产品能力边界与可移植性

- 状态：**Accepted**

## 决策

### 两种运行模式

RivalHub Broadcast 支持：

```text
Standalone / Community
  本地比赛上下文
  HUD / Radar / Program
  Broadcast Workspace / Observer Assist

RivalHub-connected
  RivalHub canonical Match / Roster / Steam64 / BP / Schedule / Branding
  + 同一套本地 Runtime
```

RivalHub 是第一方、信息最完整的赛事 context provider，但不是 Core、Radar、HUD 或 Lookahead 的运行前置条件。

### 三条能力线共享一套 Runtime Foundation

```text
Shared Runtime Foundation
├─ Tournament & Live Data
├─ Program Production
└─ Observer Assist / Lookahead
```

中文默认称呼：

- 赛事与实时数据；
- 正式节目制播；
- 观察辅助（Observer Assist / Lookahead）。

三条能力线是 ownership 边界，不要求对应三个进程或三个仓库。

### 共享基础

Shared Runtime Foundation 拥有：

- telemetry ingress / normalization；
- source continuity；
- RuntimeState / RuntimeTransition；
- identity / match binding；
- capability / health / incident；
- capture / replay；
- bounded delivery；
- consumer-specific projection 基础。

产品能力线不能复制 session、map epoch 或 identity truth。

### 依赖方向

```text
Context adapters ──────────────┐
Program telemetry adapters ────┼─→ Shared Runtime Foundation
Lookahead source adapters ─────┘            │
                                            ├─→ Program / Radar
                                            ├─→ Observer Assist
                                            └─→ data outputs
```

禁止反向依赖：

- Core 不依赖 RivalHub API client；
- Radar 不依赖 RivalHub package shape；
- Lookahead alignment 不依赖 RivalHub Web/domain implementation；
- cloud output 不拥有 RuntimeState。

### 不提前泛化

没有第二个真实 provider / consumer / 独立发行需求时，不建设：

- generic esports protocol；
- plugin marketplace；
- 为假想用户准备的复杂 SDK；
- 独立 Lookahead repository；
- 把所有第一方字段压成最低公分母的抽象层。

### 可移植性的含义

可移植不是“所有 provider 开箱即用”，而是 ownership 不制造不必要锁定：

- Core reducer/replay 不需要 RivalHub 网络；
- Program 可以由本地同形 context 驱动；
- Lookahead alignment / cue 只依赖 Broadcast-owned timeline/event contract；
- provider-specific discovery 留在 adapter；
- 缺少 RivalHub enrichment 时允许降级显示，而不是破坏时间轴正确性。

## 产品层差异

- **Broadcast Workspace**：产品体验核心；
- **Lookahead**：招牌、易感知的差异化能力；
- **Runtime / Projection / Identity / Local Protocol**：工程基础；
- **中文、开源、本地优先**：生态策略。

这些层次共享仓库，但不互相冒充 ownership。
