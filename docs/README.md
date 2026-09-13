# 文档索引

本仓库的一手文档默认使用中文；文件路径、代码标识符、协议字段和第三方专有名词可保留英文。

当前文档：

- [`product.md`](product.md)：产品需求基线。产品讨论优先更新这里。
- [`architecture.md`](architecture.md)：已冻结的架构边界与待决事项。
- [`telemetry.md`](telemetry.md)：M1 Telemetry / GSI 设计基线，定义 Raw GSI、block-specific source semantics、normalized telemetry、production capture、replay 与真实 CS2 evidence/验证边界。
- [`roadmap.md`](roadmap.md)：M0–M5 阶段目标、Issue 生命周期与 GitHub Project 组织方式。
- [`development-validation.md`](development-validation.md)：macOS 主开发、跨平台 CI、Windows + CS2 + OBS 真实验收的职责边界。
- [`references.md`](references.md)：参考项目的优缺点、维护状态与复用边界。
- [`decisions/`](decisions/)：Architecture Decision Records。
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md)：Issue-driven / agent-assisted 实施与 PR 交付规范。

当前关键 ADR：

- ADR-0001：项目定位与权威边界；
- ADR-0002：Runtime / Workspace 技术基线；
- ADR-0003：RuntimeState / projection、session/identity、delivery/backpressure、outbox 与跨仓 contract invariant；
- ADR-0004：Delayed Program 输出、machine-only Lookahead feed、Observer Assist Overlay 与 Program/OBS/#615 non-leak 边界。

文档 authority 关系：

```text
product.md
  产品要做到什么

architecture.md + ADR
  长期架构 invariant / ownership / Program vs Assist boundary

telemetry.md
  单个 GSI source 的 Raw GSI / source semantics / capture / replay evidence

roadmap.md
  阶段级交付与依赖顺序

development-validation.md
  Mac/CI/真实 Windows+CS2+OBS 的验证职责
```

RivalHub 主仓 #610 / #613 / #615 拥有主站 canonical Match Runtime、Broadcast 跨仓产品边界与 public live projection 的服务端语义；本仓 docs/ADR 拥有 Broadcast 本地 runtime 的具体实现架构。发生冲突时应先重新对齐 authority，而不是在代码中增加兼容性分叉。

后续随着实现推进预计补充：

- `protocol.md`：Broadcast-owned local protocol，以及 RivalHub BroadcastManifest / ReliableObservation / BroadcastLiveSnapshot 的 consumer/producer contract 说明；
- `scene-engine.md`：BaseScene / OverlayCue、scene policy 与 operator override；
- `radar.md`：MapGeometryProvider、RadarFrame、utility、interpolation/autozoom、renderer/asset 边界；
- `testing.md`：record/replay、fault injection、slow consumer、Program/Assist non-leak、visual regression、soak；
- `operations.md`：Windows / CS2 / OBS 正式赛事运行手册、Program preset 与 Assist Overlay 运行方式；
- `security.md`：pairing、localhost/LAN access、credential scope、Origin/protocol validation 与日志/fixture 敏感信息边界。

RFC 索引与 RFC-0001 由独立 RFC PR 负责；该 PR 合并后再把 `docs/rfcs/` 加入本索引，避免当前 canonical PR 先产生不存在的文档链接。

文档不是代码完成后的补记。涉及 authority、runtime invariant、协议语义、Program/Assist isolation、recovery/security 或高风险运行决策时，应先形成可审阅文档/ADR，再实现；普通实现细节则按 `roadmap.md` 的 just-in-time design freeze 原则推进，避免提前过度设计。
