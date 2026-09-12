# RivalHub Broadcast Agent 工作约定

本仓库大量开发可能由 coding agent 完成。Agent 必须先理解产品与架构边界，再写代码。

## 必读顺序

1. `README.md`
2. `docs/product.md`
3. `docs/architecture.md`
4. `docs/decisions/`
5. 与当前任务直接相关的协议/运行文档

## 文档语言

仓库一手文档默认中文。代码 symbol、schema 字段、行业术语和第三方项目名可保留英文。

## 不可破坏的边界

- RivalHub 是 official tournament truth owner；Broadcast 不建立第二套赛事数据库。
- 不直接连接/写入 RivalHub Supabase 表；只走公开 adapter/contract。
- Raw GSI 只存在 telemetry adapter 内，不泄漏到 Core/Renderer/public protocol。
- `packages/core` 不依赖 React、HTTP/WebSocket 实现、OBS、RivalHub DB 或具体 GSI parser。
- CompetitionEntry / Steam64 是稳定赛事身份；CT/T 与 observer slot 只是运行时映射。
- 高频 snapshot 必须 latest-wins / bounded；禁止无界排队旧状态。
- 需要可靠性的 boundary/operator event 与高频 snapshot 在语义上分离。
- Simulator/replay 必须通过生产 ingress/normalizer，不直接伪造最终 BroadcastState。
- 高级视觉效果只能在真实 telemetry capability 存在时启用，不能伪造数据精度。
- 不复制参考项目代码，除非已经明确确认许可证与复用方式；更新 `THIRD-PARTY-NOTICES.md`。

## 变更原则

- 先复用已有 owner，不建立重复基础设施。
- 涉及协议、authority、package ownership、recovery、security、packaging 的重要变化先写/更新 ADR。
- 产品需求变化先更新 `docs/product.md`。
- 不因为某个参考仓库这么实现，就默认采用其架构。
- 不为尚未存在的 consumer 提前建设复杂 plugin framework。
- 不为了“先看到画面”把 GSI shape 直接传到 React 组件。

## 测试原则

任何实时链路改动至少考虑：

- normal replay；
- slow consumer；
- reconnect；
- duplicate/out-of-order；
- wrong match；
- stale manifest；
- map/round boundary；
- 内存/queue 是否随时间增长。

实际生产验收最终需要真实 Windows + CS2 spectator + OBS 彩排，mock/simulator 不能替代真实运行证据。
