# Third-Party Notices

当前仓库仍处于初始化阶段，尚未 vendoring 或复制任何第三方运行时代码。本文件同时记录已安装的直接 dependency 与计划依赖；真正复制资产或引入第三方代码时必须继续补充精确版本与许可证文本/链接。

## M0 已安装的直接依赖

以下是本次 workspace 初始化实际声明的直接依赖。`@typescript/native` 与 `typescript` 是为同时使用 TypeScript 7 编译器和 TypeScript 6 API 兼容层而设置的 npm alias；这是 TypeScript 7 官方过渡方案。

| 项目 | 精确版本 | 当前用途 | 已知许可证 |
| --- | --- | --- | --- |
| `@eslint/js` | 10.0.1 | ESLint flat config 基础规则 | MIT |
| `@types/node` | 24.13.4 | Node 类型声明 | MIT |
| `@types/react` / `@types/react-dom` | 19.3.0 | React Web 类型声明 | MIT |
| `@typescript/native` → `typescript` | 7.0.2 | TypeScript 7 `tsc` 编译/类型检查 | Apache-2.0 |
| `typescript` → `@typescript/typescript6` | 6.0.2 | `typescript-eslint` 的 TypeScript 6 API 兼容层 | Apache-2.0 |
| `@vitejs/plugin-react` | 6.1.1 | Vite React transform | MIT |
| `eslint` | 10.10.0 | JavaScript/TypeScript lint | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | React hooks lint rules | MIT |
| `fastify` | 5.12.4 | Companion local HTTP composition layer | MIT |
| `prettier` | 3.9.6 | Source/config formatting | MIT |
| `react` / `react-dom` | 19.3.0 | Web shell presentation | MIT |
| `tsx` | 4.23.13 | Companion development runner | MIT |
| `typescript-eslint` | 8.70.0 | TypeScript-aware ESLint parser/rules | MIT |
| `vite` | 8.3.0 | Web development and production build | MIT |
| `vitest` | 5.0.0 | Unit/component-level smoke tests | MIT |
| `zod` | 4.6.2 | Protocol package runtime-schema baseline | MIT |
| `cs2parser` | 2.5.0 | `packages/telemetry-cstv` Live CSTV `/sync`/fragment reader and game-event source | GPL-3.0；仅通过内部 binding 使用，未复制代码；upstream `osztenkurden/cs2parser@74b2238b22d8a0e221be7c2d609083c93d312c7e` |

许可证链接：[MIT](https://opensource.org/license/mit)、[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)、[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)。

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
