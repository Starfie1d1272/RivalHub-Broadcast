# Third-Party Notices

当前仓库仍处于初始化阶段，**尚未 vendoring 或正式引入任何第三方运行时代码**。本文件从第一天开始记录计划依赖与参考项目的许可证边界；真正安装 dependency 或复制资产时必须更新为精确版本与许可证文本/链接。

| 项目 | 当前用途 | 已知许可证/边界 |
| --- | --- | --- |
| `@cs2dak/maps` | 计划复用地图 calibration / world→radar 等共享 owner | MIT；正式依赖前确认发布 artifact 与版本 |
| `csgogsi` / Zhen-Hai vendored package | GSI parser 候选 | package 为 MIT；Zhen/Hai App 本体不视为可复制代码来源 |
| `drweissbrot/cs-hud` | 架构/UX 参考 | ISC |
| `mortenlein/eon` | scene/operator/radar/simulator 参考 | package 声明 ISC；复用前仍逐文件核实 |
| `M3MONs/CS2-HUD` | Radar interpolation / layout 参考 | MIT |
| `lexogrine/cs2-react-hud` | HUD package / panel/action contract 参考 | MIT |
| Lexogrine HUD Manager | 产品 benchmark | 自有 EULA；不复制 Manager 源码 |
| JTs-Hud | BYOH / observer tooling 参考 | GPL-3.0；不作为当前代码底座 |
| MulNX | future observer/camera adapter 参考 | AGPL-3.0；不作为当前 core dependency |
| Excel2OBS | BP/OBS 工作流参考 | GPL-3.0；不需要其 Excel 中间层 |
| MatchZy / CounterStrikeSharp | future server game-event telemetry 参考 | 正式集成前单独核实版本与许可证 |
| ValveResourceFormat | future Source 2 asset / baked data tooling 候选 | MIT |

参考项目的存在不代表本仓库已包含其代码或资产。
