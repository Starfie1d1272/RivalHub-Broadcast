# ADR-0002：Runtime / Workspace 技术基线

- 状态：**Accepted**

## 目标

技术基线优先保证长期运行稳定、跨平台开发、可测试性和清晰 dependency boundary，而不是追求单项 benchmark 或单文件打包。

精确 patch 版本由 workspace catalog 和 lockfile 维护；本 ADR 只冻结技术路线。

## 决策

### Runtime 与语言

- 生产 Runtime：Node.js 24 LTS。
- 语言：TypeScript 7，统一 ESM。
- `strict: true`，默认开启严格 optional / indexed access 语义。
- Node package 使用 `nodenext`；Vite 前端使用 bundler resolution。
- 共享 package 不依赖 TypeScript `paths` 伪装跨包依赖。

Node 内建 TypeScript stripping 可以用于满足限制的维护脚本，但不是生产 build 策略。

### Workspace

- pnpm 12 原生 workspace。
- 单一 lockfile。
- 内部 package 使用 `workspace:`。
- 共享第三方版本使用 catalog。
- 默认使用 pnpm 递归 / filter 编排，不引入第二层 monorepo orchestrator。

只有真实 CI profiling 证明任务图或远程缓存成为瓶颈时，才评估额外 orchestrator。

### 构建

共享 package 默认输出普通 ESM JavaScript + declaration，不为减少文件数额外 bundle。

Web 使用 React + Vite 构建，不使用 SSR / Next.js。Broadcast Web 的主要消费者是本地制作界面和 OBS Browser Source，没有 SEO 或 edge rendering 需求。

### 本地服务

Companion 使用 Fastify 作为 HTTP composition layer，并通过 WebSocket plugin 提供本地实时通道。Wire schema 使用 Zod 运行时校验。

Transport 不进入 Core：

```text
packages/core
  × Fastify
  × WebSocket implementation
  × React / Vite
  × OBS client
  × RivalHub HTTP client
  × concrete GSI/CSTV parser
```

### 测试

- unit / integration：Vitest；
- browser / visual：Playwright；
- replay / simulator / fault injection：`packages/testkit`；
- Windows + CS2 + OBS：真实环境验收。

最重要的测试路径是：

```text
recorded production-like input
→ production adapter
→ Core
→ projection / protocol
→ renderer
```

### 代码质量

- ESLint flat config；
- TypeScript-aware lint；
- React hooks lint；
- Prettier 负责格式；
- `pnpm architecture:check` 负责 workspace dependency / ownership 护栏。

## 浏览器兼容

OBS Browser Source 的 CEF 版本不能假定等于最新 Chrome。节目主路径不依赖只有最新浏览器才支持的 API；增强能力需要 feature detection 和降级路径。
