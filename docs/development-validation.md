# 开发与平台验证模型

> 本文定义 RivalHub Broadcast 在 macOS 主开发、GitHub Actions 自动验证、Windows + CS2 + OBS 生产验收之间的职责边界。它回答“在哪里开发、在哪里自动验证、什么情况下才能真正验收”，而不是替代具体 Issue 的测试规格。

## 1. 三类环境

本项目明确区分三种环境：

```text
Development environment
开发环境
→ 当前主要为 macOS

Automated validation environment
自动验证环境
→ GitHub Actions / CI：macOS、Windows，必要时 Linux

Production acceptance environment
生产验收环境
→ Windows + CS2 spectator + OBS + 真实赛事配置
```

原则：**开发环境不需要等同生产环境，但生产环境要求必须被单独、明确地验收。**

不能因为主要开发机是 Mac，就把所有 Windows 相关代码交给另一名开发者；也不能因为 CI 在 Windows 上通过，就认为真实赛事环境已经验收。

## 2. 四层验证

### Layer A — Deterministic / platform-independent

应尽可能在任意开发机和 CI 中完整验证：

- protocol / schema；
- RuntimeState / projector；
- identity state machine；
- session / producer instance / map epoch / seq；
- accumulator；
- scene policy；
- Radar framework-neutral math / geometry；
- latest-wins backpressure；
- reliable observation outbox state machine；
- recorder / replay / simulator；
- RivalHub contract compatibility。

如果这些模块因为“没有 Windows”而无法开发或单测，优先检查是否错误耦合了平台/adapter。

### Layer B — Browser / local runtime

主要可在 macOS 开发，并由跨平台 CI 补充验证：

- Fastify Companion；
- local HTTP / WebSocket；
- `/operator` / `/program` / `/debug`；
- React HUD / Radar renderer；
- scene UI；
- reconnect / baseline snapshot；
- local cache；
- OBS Browser Source 基础兼容测试。

macOS OBS 可以用于早期 Browser Source 验证，但不能替代 Windows 生产验收。

### Layer C — Real CS2 validation

需要可运行真实 CS2 的机器。该机器的首要职责是**提供真实输入与验收证据**，不默认成为整个 GSI/runtime 模块的代码 owner。

至少覆盖：

- GSI cfg 安装与发现；
- 真实 payload shape / partial update；
- 真实 update cadence；
- warmup / freezetime / round start / round end；
- halftime / side switch；
- map end / map change；
- disconnect / reconnect；
- map/server restart；
- spectator / player identity；
- bomb / grenade / smoke / inferno 等实际字段行为。

### Layer D — Production acceptance

发布候选必须在真实赛事形态完成：

```text
Windows 11
+ CS2 spectator
+ RivalHub Broadcast Companion
+ Program / Operator
+ OBS Browser Source
+ 实际赛事配置
```

重点验收：

- 完整 BO3/等价长时流程；
- wall-clock soak；
- CPU / memory / latency；
- queue 是否长期增长；
- OBS source reload；
- Companion restart；
- CS2 restart；
- 网络中断 / RivalHub 短暂不可达；
- wrong match / stale manifest；
- map restart / stale epoch；
- fallback / recovery runbook。

CI 绿灯不能替代 Layer D。

## 3. Issue 必须声明的平台要求

每个 execution Issue 都必须区分以下三项：

### Implementation environment

```text
Cross-platform / macOS-primary
Windows-specific
Other explicit environment
```

表示“代码可以在哪里实现”。

### Automated validation

按实际需要选择：

```text
Local deterministic tests
macOS CI
Windows CI
macOS + Windows CI
Linux CI
```

表示“哪些自动化环境必须通过”。

### Real-environment acceptance gate

按任务选择：

```text
Not required
Real Windows
Windows + CS2
Windows + OBS
Windows + CS2 + OBS
```

表示“Issue/Release 是否仍欠生产环境证据”。

**能开发**与**能最终验收**是两回事。一个 Issue 可以在 Mac 上实现并进入 PR，同时明确等待 Windows acceptance；但如果该真实环境证据属于本 Issue 的 closing criteria，则在证据补齐前不能伪装成 Done。

## 4. Windows validation lane 的协作方式

默认采用：

```text
Feature owner
+ Platform validator
```

而不是：

```text
Mac developer owns Core
Windows developer owns all GSI/OBS work
```

示例：

```text
Issue: GSI normalization

Implementation owner:
  主开发者 / Luna

Platform validator:
  有 Windows + CS2 环境的协作者

Evidence:
  unit/replay tests
  + real Windows CS2 capture / acceptance
```

只有明显 Windows-specific 的工作（例如 installer、GSI cfg 自动安装、Windows packaging/launcher）适合整块由 Windows contributor 负责。

## 5. Real GSI Reference Capture Pack

一旦最小 recorder 可用，应尽快由 Windows + CS2 环境录制可复现的真实 fixture corpus。

建议覆盖：

```text
normal round
kill / damage
bomb plant / defuse / explode
grenades
smoke / molotov
halftime / side switch
map end / map change
disconnect / reconnect
restart（可行时）
```

每次 capture 至少记录：

- Windows version；
- CS2 build/version；
- GSI cfg；
- capture timestamp；
- scenario notes；
- 是否含敏感 token / account data，进入仓库前必须 scrub。

真实 capture 的目标是把昂贵、难重复的生产输入转换成可在 Mac/CI 中持续 replay 的测试资产。

## 6. 当前现实约束（2026-09）

当前主要开发环境为 macOS，主 Windows 开发机暂不可用；比赛仍有约二十天准备窗口。

因此当前策略是：

1. M0、M1 大部分、M2 的平台无关部分继续在 Mac 上推进；
2. 尽快借用协作者 Windows + CS2 环境完成第一批真实 GSI capture；
3. CI 建立后尽早加入 Windows runner 进行 build/test/smoke；
4. 主 Windows 环境恢复后安排一次集中 platform-validation sprint；
5. 开赛前约 5–7 天进入 feature freeze，以 rehearsal / soak / bugfix / fallback 为主，不再扩张高风险功能。

这个时间窗口是当前项目计划，不属于长期架构 invariant；实际日期变化时更新 Roadmap / Project，而不需要 ADR。
