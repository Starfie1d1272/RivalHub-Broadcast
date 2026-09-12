# 文档索引

本仓库的一手文档默认使用中文；文件路径、代码标识符、协议字段和第三方专有名词可保留英文。

当前文档：

- [`product.md`](product.md)：产品需求基线。产品讨论优先更新这里。
- [`architecture.md`](architecture.md)：已冻结的架构边界与待决事项。
- [`references.md`](references.md)：参考项目的优缺点、维护状态与复用边界。
- [`decisions/`](decisions/)：Architecture Decision Records。

当前关键 ADR：

- ADR-0001：项目定位与权威边界；
- ADR-0002：Runtime / Workspace 技术基线；
- ADR-0003：RuntimeState / projection、session/identity、delivery/backpressure、outbox 与跨仓 contract invariant。

后续随着实现推进预计补充：

- `protocol.md`：Broadcast-owned local protocol，以及 RivalHub BroadcastManifest / ReliableObservation / BroadcastLiveSnapshot 的 consumer/producer contract 说明；
- `telemetry.md`：GSI 与 enhanced telemetry；
- `scene-engine.md`：BaseScene / OverlayCue、scene policy 与 operator override；
- `radar.md`：MapGeometryProvider、RadarFrame、utility、interpolation/autozoom、renderer/asset 边界；
- `testing.md`：record/replay、fault injection、slow consumer、visual regression、soak；
- `operations.md`：Windows / CS2 / OBS 正式赛事运行手册；
- `security.md`：pairing、localhost/LAN access、credential scope、Origin/protocol validation 与日志/fixture 敏感信息边界。

文档不是代码完成后的补记。涉及 authority、runtime invariant、协议语义、recovery/security 或高风险运行决策时，应先形成可审阅文档/ADR，再实现。