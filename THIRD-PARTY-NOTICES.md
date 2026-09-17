# Third-Party Notices

本文件记录 RivalHub Broadcast 仓库当前直接声明的第三方依赖及其已知许可证。精确依赖版本以 `pnpm-workspace.yaml` 和 `pnpm-lock.yaml` 为机器来源。

研究参考项目不属于安装依赖，也不在本文件登记；相关内容见 [`docs/references.md`](docs/references.md)。

| 依赖 | 当前版本 | 用途 | 许可证 |
| --- | ---: | --- | --- |
| `@eslint/js` | 10.0.1 | ESLint 基础规则 | MIT |
| `@fastify/static` | 10.1.3 | Companion 静态文件服务 | MIT |
| `@fastify/websocket` | 11.3.0 | Companion WebSocket 承载 | MIT |
| `@fontsource/inter` | 5.3.0 | Program/Web 本地字体 | OFL-1.1 |
| `@playwright/test` | 1.63.0 | 浏览器与视觉回归 | Apache-2.0 |
| `@types/node` | 24.13.4 | Node 类型声明 | MIT |
| `@types/react` | 19.3.0 | React 类型声明 | MIT |
| `@types/react-dom` | 19.3.0 | React DOM 类型声明 | MIT |
| `@types/ws` | 8.18.1 | WebSocket 类型声明 | MIT |
| `@typescript/native` → `typescript` | 7.0.2 | TypeScript 7 编译与类型检查 | Apache-2.0 |
| `@vitejs/plugin-react` | 6.1.1 | Vite React 插件 | MIT |
| `cs2parser` | 2.5.0 | CSTV fragment / GameEvent source | GPL-3.0 |
| `eslint` | 10.10.0 | 静态检查 | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | React Hooks 规则 | MIT |
| `fastify` | 5.12.4 | Companion HTTP 组合层 | MIT |
| `jsdom` | 26.1.0 | 测试 DOM 环境 | MIT |
| `prettier` | 3.9.6 | 代码格式化 | MIT |
| `react` | 19.3.0 | Web 渲染 | MIT |
| `react-dom` | 19.3.0 | Web DOM 渲染 | MIT |
| `tsx` | 4.23.13 | 开发脚本运行 | MIT |
| `typescript` → `@typescript/typescript6` | 6.0.2 | TypeScript tooling API 兼容层 | Apache-2.0 |
| `typescript-eslint` | 8.70.0 | TypeScript-aware ESLint | MIT |
| `vite` | 8.3.0 | Web 构建与开发服务 | MIT |
| `vitest` | 5.0.0 | 单元与集成测试 | MIT |
| `zod` | 4.6.2 | Runtime schema validation | MIT |

`cs2parser` 只通过 `packages/telemetry-cstv` 内部 binding 使用；其第三方类型不成为 Broadcast 公共 contract。本仓库未因研究参考而复制 HOT、Boltobserv、Lexogrine HUD Manager、Obserview、Zhenhai HUD Manager 等应用的代码或图片资产。

许可证参考：

- MIT: https://opensource.org/license/mit
- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0
- OFL-1.1: https://openfontlicense.org/
- GPL-3.0: https://www.gnu.org/licenses/gpl-3.0.html
