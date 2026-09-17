# 参考项目与吸收边界

> 最近审阅：2026-09-16

RivalHub Broadcast 不以单一 HUD Manager 为代码底座。现有项目只作为产品、架构、协议、性能和运维参考；任何代码、资产或运行时依赖真正进入仓库前，仍需单独确认许可证、维护状态和当前版本。

| 项目 | 主要学习点 | 不直接继承的部分 |
| --- | --- | --- |
| `drweissbrot/cs-hud` | 最小 GSI → 本地服务 → HUD/配置/雷达 → OBS 浏览器源；本地优先 | 老旧技术结构与有限的场景/产品模型 |
| `mortenlein/eon` | Waiting/Intermission/Result、Operator、Simulator、Radar、临时分析能力、确定性测试场景与 Playwright 测试纪律；长期运行/重连经验 | 不继承其逐步演化出的单体 GSI/服务端结构；呈现测试场景不从 Raw GSI 或服务端模拟器起步 |
| `nsnsay/Zhenhai-HUD-Manager` | TypeScript workspace、`csgogsi`、手雷/烟雾/燃烧弹、上下层 Radar、监听器生命周期 | 应用仓库顶层许可证边界不清；不复制应用代码/资产，也不继承第二套 Team/Match 数据库 |
| 旧 Void / Void-HUD-Overlay | 高频管线的性能反例 | `structuredClone` 全量 payload + 递归遍历 + producer>consumer backlog |
| Boltobserv | 专业观察者雷达、高级选手状态、自动缩放、观察者辅助、上下层、高度、道具、Browser/OBS 输出 | GPL-3.0；不作为旁路服务或第二套 GSI runtime，不复制其应用实现；重点吸收 Radar 产品/算法经验 |
| Lexogrine Obserview | 独立 Radar 体验、头像标记、画笔、跨电脑绘制同步 | **许可证元数据冲突**：根 `LICENSE` 为 MIT，但 `package.json` 标注 GPL-3.0；代码级复用前必须确认；依赖 LHM/csgogsi-socket 且技术栈较旧 |
| Lexogrine HUD Manager | 成熟生产使用体验、HUD 包、面板/操作、BP/摄像机/回放生态 | Manager 本体为自有 EULA，不作为代码来源 |
| `lexogrine/cs2-react-hud` | #33 可参考的选手卡、图标组合、当前观察选手高亮、比分条/聚焦选手卡组件拆分 | 不让 LHM contract 成为内部 RuntimeState / Broadcast protocol；#31 不提前复制组件 |
| JTs-Hud | BYOH、HUD 包、GSI 安装、观察者工具、LHM 兼容 | GPL Manager 不作为底座；其本地 Team/Player/Match 数据库与 RivalHub 重复 |
| M3MONs/CS2-HUD | 固定 1920×1080 逻辑画布、离线预览纪律；Radar 插值与 rAF 高频更新路径留给 #34 参考 | 不继承拖拽布局编辑器、另一套配置/后端/状态权威来源；Python/FastAPI 不是本项目默认 runtime 方向 |
| SHUD | OBS/场景/摄像机的生产外壳、LHM/OpenHUD 兼容 | 公开源码不足以作为完整实现底座 |
| MulNX | 高级观察者/摄像机/电影化能力、localhost API | injection/hook/`-insecure` 安全域不同，仅考虑未来可选适配器 |
| Excel2OBS | 赛事 BP 图卡逐步出现的操作体验 | RivalHub 场景不需要 Excel/OBS source mutation 中间层 |
| MatchZy / CounterStrikeSharp | 服务端游戏事件、可靠的击杀/伤害/回合/炸弹增强 telemetry | 不能要求所有比赛服务器必装，因此不能成为基础 HUD 前提 |
| ValveResourceFormat | Source 2 资源解析、未来地图/C4 烘焙数据工具 | 不把完整 Viewer/.NET 应用塞入 Broadcast runtime |

## 雷达方案综合

Radar 不等于地图校准，也不等于某一个现成 Radar 应用：

```text
Map geometry / calibration
  → MapGeometryProvider
  → Broadcast checked-in CS2 overview calibration snapshot；DAK 仅作独立交叉参考

Radar domain
  → RadarFrame / world→radar / floor / marker / utility semantics

Radar presentation / renderer
  → React / SVG / Canvas / DOM / theme / rAF
  → interpolation / smoothing / autozoom presentation / responsive sizing
```

Boltobserv / Obserview 用来验证观察者体验、自动缩放、头像标记、画笔等产品方向，但不作为第二套 runtime。

## 复用原则

1. 优先复用许可证明确且宽松的小型库，而不是复制整个应用。
2. 参考产品体验或架构不等于复制源码。
3. GPL/AGPL 项目如果只作为研究参考，应保持净室实现；任何代码级复用都要单独评估许可证后果。
4. LHM Manager 等专有软件只做产品对照。
5. 第三方内部类型不得成为 Broadcast 公共协议的权威来源。
6. 已存在明确权威来源的共享基础设施，应优先通过 adapter/provider 复用，而不是在 Broadcast 再维护一份真相。
7. 对“当前实现是否仍存在某缺口”的判断，如果依赖具体代码行为，应记录核验日期；长期重要或容易变化的结论可额外记录 commit SHA，不要求每条体验观察都固定 commit。

实际新增依赖时更新根目录 `THIRD-PARTY-NOTICES.md`。

## Issue #31 主要参考项目审计

本节记录 2026-09-16 重新审阅的版本与本 Issue 的净室实现边界；这些项目没有被复制为代码或资产，也不是 Broadcast runtime/state 的权威来源。

| 参考项目 | 审计版本 / 许可证 | #31 吸收 | #31 明确不继承 |
| --- | --- | --- | --- |
| `lexogrine/cs2-react-hud` | `7874750c97fcecd8f72eb3fad382917e035ec651` / MIT | #33 的选手卡、图标组合、当前观察选手高亮、比分条/聚焦选手卡拆分思路 | `csgogsi`/LHM 状态权威、远程字体、killfeed/runtime 语义；#31 不复制组件源码 |
| `M3MONs/CS2-HUD` | `30f99ab8aded4587529e8ad09ea25b97e994edb3` / MIT | 固定 1920×1080 逻辑画布、离线预览纪律 | 布局编辑器、另一套配置/后端/状态权威来源、Radar 平滑实现 |
| `mortenlein/eon` | `5c05ef04545d440f0355dea359d341c32d11f3ef` / package ISC | 模拟器/测试场景与 Playwright 测试纪律、本地打包字体思路 | 从 Raw GSI/服务端模拟器构造呈现测试场景；单体服务端/GSI/UI 状态 |
| `drweissbrot/cs-hud` | `5595dd02d67f0ca674d96d8c629e067ec6528c1b` / ISC | 本地优先、聚焦选手组件拆分作为后续参考 | 老旧主题/文件/状态架构 |
| `boltgolt/boltobserv` | `0320883198e438cd6ae9fd490fa310027003727e` / GPL-3.0 | Radar 产品语义、标记状态、上下层/观察者体验 | 任何代码/资产复制、旁路服务或第二套 GSI runtime |
| `lexogrine/obserview` | `36251ed3b42926a2697782bc5aa0dbaedc9891fb` / 根 `LICENSE` MIT、`package.json` GPL-3.0 | 独立 Radar/头像/画笔产品参考 | 许可证元数据冲突；澄清前不做代码级复用，也不继承旧 React/LHM/csgogsi-socket 状态 |
| `nsnsay/Zhenhai-HUD-Manager` | `8244dcaa0b52a4cb24bf0dbfc26b1b0455de23f7` / 应用仓库顶层许可证边界不清 | 信息密度、上下层 Radar、监听器生命周期产品参考 | 不复制应用代码/资产，不建立第二套 Team/Player/Match 数据库 |

本 Issue 采用 **M3MONs 的固定画布 + Eon 的确定性测试场景/测试纪律 + Playwright 官方截图回归 + Broadcast 自有 `ProgramSnapshot` 契约**。Lexogrine HUD 仅作为 #33 的潜在组件参考；Obserview 的许可证元数据冲突继续显式记录。
