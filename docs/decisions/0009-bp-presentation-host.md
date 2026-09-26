# ADR-0009：BP 独立播出 Host 与播放会话

- 状态：Accepted
- 日期：2026-09-26

## 决策

BP 是 Program presentation family 中独立的透明 `/program/bp` Browser Source，逻辑画布 1920×1080。OBS 添加该地址到赛前/图间场景，以 OBS 场景或 source visibility 决定最终合成；它不切换 `/program` Gameplay，也不是 HUD widget。制作控制首页提供 BP 播放/收起与进入 `/operator/bp` 预览的入口；预览复用同一 renderer。未来 Waiting/Result 仍是独立工作，不引入 scene engine。

本机需要看 BP 时直接打开同一地址，与 OBS 同步读取同一会话；各 Host 是否可见由窗口/OBS 控制，不增加另一份播放状态。本轮不实现私有 observer overlay 的独立 BP 开关。

Core 从已绑定 MatchContext 派生有限、Program-safe BP projection。不存在遥测时仍允许赛前播放；明确身份 mismatch 时禁止输出。参赛实体固定左 A 右 B；开局边两行显示真实队名和 CT/T，决胜图不标选图方。缺失事实留空。

Companion 独占内存 Presentation session，状态 hidden / revealing / shown / hiding，不写 RuntimeState、SeriesProgress、MatchContext 或磁盘。基于 monotonic clock，默认每 1600 ms reveal，360 ms exit；不使用客户端时钟续播。HTTP `/local/v1/bp` 仅返回有界当前 baseline，客户端串行轮询，不补离线步骤；重连/reload 首份 baseline 无入场动画。断连/超时隐藏，服务重启 hidden，比赛/BP 内容变化或 mismatch 清空会话。

`POST /operator/bp-command` 仅接受 play/hide 和预期 revision；沿用 loopback + 精确 Origin 校验，LAN 禁写。并发/旧请求返回冲突，不排队重试。只读响应采用独立版本 schema 与 ETag，不更改现有四个 snapshot channel。

## 比赛清单入口

当前产品通过 `/operator/bp` 导入既有 Broadcast Manifest JSON，复用 MatchContextController 与 LKG 校验、保存及 binding 回调，同步整个 Runtime 的比赛上下文。该入口不编辑单个 veto slot，也不声称已连接 RivalHub 在线自动刷新；在线 source 后续仍接同一 controller。导入有 revision 与单请求并发保护，失败时旧比赛清空。缓存位于产品 state；服务重启后主动重新导入，不静默恢复或播放。
