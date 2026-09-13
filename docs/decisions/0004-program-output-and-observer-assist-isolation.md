# ADR-0004：Program 输出与 Observer Assist 隔离

- 状态：**Accepted**
- 日期：2026-09-14
- 关联：ADR-0001、ADR-0003、`docs/product.md`、`docs/architecture.md`、RivalHub #610 / #613 / #615、RFC-0001

## 背景

当前 RivalHub Major 的真实制播工作流是**单机、单人解说兼 OB**：同一个人在一台 Windows 机器上连接延迟 GOTV、解说、手动切换观察视角，并通过 OBS 输出正式节目。

Perfect World 当前实际提供同一场比赛的两条成对 GOTV：

```text
No-delay GOTV
  例如 endpoint ...5
  不给人直接观看
  不进入 OBS
  只供机器 headless 解析 future event / timeline alignment

Delayed Program GOTV
  例如 endpoint ...6
  约 120 秒 spectator delay
  CS2 observer 实际连接
  Program HUD / Radar 跟随该时间轴
  OBS 捕获正式节目
```

此前讨论曾把这个场景抽象成 `Caster` 与 `Operator` 两类现场用户，以及两个可相互降级的 telemetry source。该抽象不符合当前真实运营方式，也制造了并不存在的 Program failover 问题。

本 ADR 重新冻结最小、真实的业务边界。

---

## 决策 1：现场只有一个制作角色，不建立独立 Caster role

当前产品的主要现场用户是：

> **解说兼 OB / 制作人员。**

同一个人：

- 看 CS2 延迟节目画面；
- 解说；
- 手动切 POV；
- 需要时打开 Operator 配置/诊断；
- 可以看到本机 Observer Assist Overlay。

因此本仓**不要求**存在独立 `/caster` surface，也不建立 `CasterProjection` 作为长期业务角色模型。

`/operator` 是控制/诊断界面，不意味着现场存在另一位“导播用户”。

---

## 决策 2：Program feed 与 Lookahead feed 不是两个对等 Program source

二者的资格不同：

```text
Delayed Program feed
  → CS2 renderer
  → Runtime 的正式节目时间轴
  → /program
  → OBS
  → #615 BroadcastLiveSnapshot

No-delay Lookahead feed
  → machine-only parser
  → future-event evidence / timeline alignment
  → Observer Assist
  × 不渲染为 Program
  × 不进入 OBS
  × 不进入 #615
  × 不具备 Program fallback eligibility
```

因此不设计：

```text
Program down
→ 自动/手工把 Lookahead feed 切成 Program
```

如果 Program feed 故障，就是节目输入故障；如果 Lookahead feed 故障，Program 正常继续，只关闭/降级 Assist。

Perfect 的 `...5 / ...6` 与约 120 秒 delay 属于 provider deployment fact / discovery heuristic，不能硬编码进 Core。启用 Assist 前仍要校验 same match / map / timeline alignment。

---

## 决策 3：Observer Assist 是本地私有显示层，不是第二套节目

Observer Assist 的目标是帮助同一个解说兼 OB 提前切镜。

第一阶段的最小完整产品：

```text
No-delay GOTV
→ 观察到 player_death
→ attacker / victim / event tick / 可可靠获得的位置上下文

Delayed Program GOTV
→ 当前 program tick

Timeline alignment
→ 计算该 kill 距离 Program 还有多久

约 T-10s
→ 本地透明 / click-through Assist Overlay
→ countdown + killer → victim + optional location

人
→ 自己决定切 POV
```

第一阶段**不要求**：

- 佯攻/主攻识别；
- engagement/story 聚类；
- 复杂 importance ranking；
- AI / physics prediction；
- 自动 TAKE / 自动切镜；
- 第二个 CS2 renderer。

RFC-0001 可以继续研究更丰富的 cue aggregation、推荐 POV、local relay 等能力，但这些不是基础 Assist 的上线前提。

---

## 决策 4：Program / Assist 在数据和捕获边界上硬隔离

Core 仍只有一份内部 `RuntimeState`。Assist 不成为第二份 domain truth。

至少区分 consumer projection：

```text
ProgramProjection
  正式节目允许显示的信息

ObserverAssistProjection
  只包含本机 Assist 所需的未来事件提示
  不作为 Program 的超集

OperatorProjection
  match / health / scene / incident / recovery / OBS / uplink

DebugProjection
  raw / normalized diagnostics / timing / evidence
```

规则：

- Lookahead future information 不得进入 `ProgramProjection`；
- Assist-only 字段不得先发给 Program 再靠 CSS 隐藏；
- 官方 OBS Program preset 不得包含 Assist surface/window；
- #615 只从 Delayed Program timeline 生成 public live snapshot；
- Assist 以透明置顶窗口实现时，必须在真实 Windows + OBS 验收中证明不会被官方 capture 路径误录。

---

## 决策 5：Lookahead feed 不自动扩张为 #610 canonical source

#610 Match lifecycle 不依赖 Broadcast/GSI；Broadcast 仍是可选 observation source。

当前 no-delay feed 的明确业务 owner 是 **Observer Assist**。

虽然未来技术上可以让更早的可信 evidence 参与 `match_started / map_ended` 等 ReliableObservation，但本 ADR 不因为“数据已经存在”自动赋予该 feed canonical responsibility。

若未来需要，应在 RivalHub-facing contract 中单独决定：

- 哪些 observation 可以来自 lookahead feed；
- identity / session / health 要求；
- 是否影响自动 canonicalization eligibility。

这避免把一个简单的切镜辅助功能变成 Match Runtime 的隐式依赖。

---

## 决策 6：#610 / identity 的既有边界继续成立

Broadcast 必须自动比较：

```text
canonical MatchRoster / Steam64
↕
observed players
```

正常一致时无感通过；mismatch / wrong-match / stale 等异常才进入人工处理。

`MatchPreparation` 与 `ObservationHealth` 不压成一个 `canStart` boolean。现实比赛已经可信开始时，准备事项或 roster incident 不能否认已经发生的事实；但有身份冲突的 result candidate 不应自动 canonicalize。

---

## 验证要求

自动验证至少覆盖：

- `ObserverAssistProjection` 的 future fields 不出现在 `ProgramProjection`；
- #615 producer 不读取 no-delay future state；
- Lookahead feed down 时 Program 不受影响；
- Program feed down 时不存在 Lookahead→Program fallback；
- wrong-match / map mismatch / alignment unhealthy 时 Assist fail closed；
- timeline reconnect/map change 后重新建立 alignment 才恢复 cue。

真实生产验收至少覆盖：

```text
Windows + CS2 delayed observer + OBS
+ no-delay headless lookahead feed
+ topmost Assist Overlay
```

并验证：

- Assist overlay 不进入官方 OBS Program output；
- kill cue lead time 稳定可用；
- CPU / memory / network 不影响 CS2/OBS 稳定性；
- Lookahead 故障只降级 Assist。

---

## 结果

本 ADR 保留 ADR-0003 的核心结论：

- 一个 `RuntimeState`；
- consumer-specific projection；
- snapshot / transition / command / observation / incident 分离；
- latest-wins、identity、session/time/outbox invariant 继续成立。

新增冻结的是：

- 单人解说兼 OB 的真实角色模型；
- Delayed Program feed 与 machine-only Lookahead feed 的不对等职责；
- Observer Assist 作为本地私有 overlay；
- no Lookahead→Program fallback；
- future cue 与 Program/#615/OBS 的硬隔离。
