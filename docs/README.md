# 文档索引

本仓库的一手文档默认使用中文；文件路径、代码标识符、协议字段和第三方专有名词可保留英文。

当前文档：

- [`product.md`](product.md)：产品需求基线。产品讨论优先更新这里。
- [`architecture.md`](architecture.md)：已冻结的架构边界与待决事项。
- [`references.md`](references.md)：参考项目的优缺点与复用边界。
- [`decisions/`](decisions/)：Architecture Decision Records。

后续随着设计推进预计补充：

- `protocol.md`：BroadcastManifest / BroadcastState / RuntimeEvent / Uplink contract；
- `telemetry.md`：GSI 与 enhanced telemetry；
- `scene-engine.md`：scene state machine 与 operator override；
- `radar.md`：地图标定、utility、动画与 asset；
- `testing.md`：record/replay、fault injection、visual regression、soak；
- `operations.md`：Windows / CS2 / OBS 正式赛事运行手册；
- `security.md`：pairing、local/LAN access、token 与日志敏感信息边界。

文档不是代码完成后的补记。涉及架构 owner、协议语义、数据权威或高风险运行决策时，应先形成可审阅文档/ADR，再实现。
