# 文档索引

本仓库的一手文档默认使用中文；文件路径、代码标识符、协议字段和第三方专有名词可保留英文。

当前文档：

- [`product.md`](product.md)：产品需求基线。产品讨论优先更新这里；顶层产品结构按“赛事与实时数据 / 正式节目制播 / Observer Assist”三条能力线组织。
- [`architecture.md`](architecture.md)：已冻结的架构边界与待决事项；当前 runtime 模型以 current snapshot + explicit transition 为核心，并区分 Program-safe / Assist-private state、source-local continuity，以及第一方 RivalHub adapter 与 Shared Runtime Foundation 的依赖边界。
- [`telemetry.md`](telemetry.md)：M1 Telemetry / GSI 设计基线，定义 Raw GSI、block-specific source semantics、normalized telemetry、production capture、replay 与真实 CS2 evidence/验证边界。
- [`roadmap.md`](roadmap.md)：M0–M5 阶段目标、三条产品能力线的阶段映射、RivalHub read/write 集成顺序、Issue 生命周期与 GitHub Project 组织方式。
- [`development-validation.md`](development-validation.md)：macOS 主开发、跨平台 CI、真实 Windows + CS2/CSTV + OBS 验收与 reference corpus 的职责边界。
- [`references.md`](references.md)：参考项目的优缺点、维护状态与复用边界。
- [`rfcs/`](rfcs/)：重大但尚未完全冻结的专项产品/技术设计；RFC-0001 负责 Lookahead acquisition、alignment、cue scheduling、portability 与可选增强研究。
- [`decisions/`](decisions/)：Architecture Decision Records。
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md)：Issue-driven / agent-assisted 实施与 PR 交付规范。

当前关键 ADR：

- ADR-0001：项目定位与权威边界；
- ADR-0002：Runtime / Workspace 技术基线；
- ADR-0003：RuntimeState / projection、session/identity、delivery/backpressure、outbox 与跨仓 contract invariant；
- ADR-0004：Delayed Program 输出、machine-only Lookahead feed、Observer Assist Overlay、Program/Assist non-leak 与双 source continuity 边界；
- ADR-0005：赛事与实时数据 / 正式节目制播 / Observer Assist 三条产品能力线、Shared Runtime Foundation，以及 RivalHub 第一方集成与 Core/Lookahead 可移植性边界。

文档 authority 关系：

```text
product.md
  产品要做到什么；三条能力线分别解决什么问题

architecture.md + ADR
  长期架构 invariant / ownership / 第一方 adapter / Program vs Assist boundary

telemetry.md
  单个 GSI source 的 Raw GSI / source semantics / capture / replay evidence

rfcs/
  尚未完全冻结的专项设计；不能覆盖 Accepted ADR

roadmap.md
  阶段级交付、三条能力线的推进顺序、RivalHub read/write 接入顺序与依赖

development-validation.md
  Mac/CI/真实 Windows+CS2/CSTV+OBS 的验证职责
```

RivalHub 主仓 #610 / #613 / #615 拥有主站 canonical Match Runtime、Broadcast 跨仓产品边界与 public live projection 的服务端语义；本仓 docs/ADR 拥有 Broadcast 本地 runtime 的具体实现架构。RFC 必须建立在这些 canonical boundary 上，发生冲突时应先重新对齐 authority，而不是在代码中增加兼容性分叉。

后续随着实现推进预计补充：

- `protocol.md`：Broadcast-owned local protocol，以及 RivalHub BroadcastManifest / ReliableObservation / BroadcastLiveSnapshot 的 consumer/producer contract 说明；
- `scene-engine.md`：BaseScene / OverlayCue、scene policy 与 operator override；
- `radar.md`：MapGeometryProvider、RadarFrame、utility、interpolation/autozoom、renderer/asset 边界；
- `testing.md`：record/replay、fault injection、slow consumer、source generation、Program/Assist non-leak、visual regression、soak；
- `operations.md`：Windows / CS2 / CSTV / OBS 正式赛事运行手册、Program preset 与 Assist Overlay 运行方式；
- `security.md`：pairing、localhost/LAN access、credential scope、Origin/protocol validation 与日志/fixture 敏感信息边界。

文档不是代码完成后的补记。涉及 authority、runtime invariant、协议语义、Program/Assist isolation、recovery/security 或高风险运行决策时，应先形成可审阅文档/ADR，再实现；普通实现细节则按 `roadmap.md` 的 just-in-time design freeze 原则推进，避免提前过度设计。