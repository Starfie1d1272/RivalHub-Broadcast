# ADR-0009：BP 全屏播出场景、本地制作与播放会话

- 状态：Accepted
- 日期：2026-09-26

## 决策

BP 是 Program presentation family 中独立的全屏不透明 `/program/bp` Browser Source，逻辑画布 1920×1080。OBS 将该地址作为完整赛前/图间场景装载；它不切换 `/program` Gameplay，也不是 HUD widget。`/operator/bp` 是来源、状态、本地填写和预览共用的工作台，预览复用同一 renderer。未来 Waiting/Result 仍是独立工作，不引入 scene engine。

本机需要看 BP 时直接打开同一地址，与 OBS 同步读取同一会话；各 Host 是否可见由窗口/OBS 控制，不增加另一份播放状态。本轮不实现私有 observer overlay 的独立 BP 开关。

Core 从已绑定 MatchContext 派生有限、Program-safe BP projection。不存在遥测时仍允许赛前播放；身份 mismatch 或 BP 事实冲突时禁止输出。参赛实体固定左 A 右 B；地图卡只显示真正执行 SIDE_PICK 的队伍和选择边，缺失 actor 时不显示选边。BO5 决胜图采用 knife round，不产生选边行；决胜图不标选图方。

Companion 独占内存 Presentation session，状态 hidden / revealing / shown / hiding，不写 RuntimeState、SeriesProgress、MatchContext 或磁盘。基于 monotonic clock，默认每 1600 ms reveal，360 ms exit；不使用客户端时钟续播。HTTP `/local/v1/bp` 仅返回有界当前 baseline，客户端串行轮询，不补离线步骤；重连/reload 首份 baseline 无入场动画。断连/超时隐藏，服务重启 hidden，比赛/BP 内容变化或 mismatch 清空会话。

`POST /operator/bp-command` 仅接受 play/hide 和预期 revision；沿用 loopback + 精确 Origin 校验，LAN 禁写。并发/旧请求返回冲突，不排队重试。只读响应采用独立版本 schema 与 ETag，不更改现有四个 snapshot channel。

## 比赛来源与本地 authoring

已绑定的 RivalHub MatchContext 是 connected 路径的唯一官方来源。本轮不创建 JSON 导入产品流程或 fixture 普通 UI，也不伪造当前 RivalHub `main` 尚未提供的 BroadcastManifest HTTP endpoint。

没有有效 online/cache BP 时，制作人员可在 `/operator/bp` 用结构化字段填写队伍、赛制、7-map pool 和地图/选边。操作方由冻结的 BO sequence 决定，不可手工改；BO5 决胜图无 SIDE 选择。Companion 把 LocalBpDraft 编译为标准 BroadcastManifest，经相同 validator → MatchContextController → ProjectionCoordinator → BP projection 路径，并写入同一 `match-context.json` LKG。不存在平行的 LocalBPState；失败时现有 binding 不变，成功时 source 切到 local 且播放 session 收起。

服务重启后，从同一 LKG 恢复比赛上下文并向普通 UI 标记为“本地缓存”；session 仍从 hidden 开始。在线 source 后续恢复时只能成为待确认候选，必须由制作人员显式切回 RivalHub，不能自动抢占本地比赛。JSON、fixtures 和内部 revision 不进入普通工作台。
