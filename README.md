# RivalHub Broadcast

RivalHub Broadcast 是一套 **本地优先、开源、中文优先的 CS2 赛事制播工具**。它把赛事上下文、CS2 实时数据、HUD、雷达、场景、制作控制和观察辅助放在同一套可靠运行时上，同时保持正式节目与辅助信息严格隔离。

项目既可以独立服务校园赛、社区赛和小型赛事，也可以连接 RivalHub，直接复用已经维护好的比赛、队伍、名单、Steam64、BP、赛程和品牌信息。

## 产品形态

```text
RivalHub Broadcast
├─ 独立 / 社区模式
│  ├─ 本地比赛上下文
│  ├─ HUD / Radar / OBS
│  └─ 制播工作区 / 观察辅助
│
└─ RivalHub 连接模式
   └─ 读取 RivalHub 的完整赛事上下文
```

RivalHub 是最完整的第一方赛事上下文提供方，但不是 Broadcast 的运行前置条件。共享运行时、HUD、雷达和观察辅助不依赖 RivalHub 内部数据库或页面实现。

产品可以从四个层次理解：

- **制播工作区**：制作人员实际使用的统一工作环境；CS2 画面保持视觉主体，雷达、状态、控制和辅助信息围绕它组织。
- **Lookahead 观察辅助**：利用较早的比赛时间轴，为延迟正式节目生成低干扰的确定性提示。
- **运行时基础**：负责数据源连续性、身份、状态、投影、本地协议、回放和有界投递。
- **中文、开源、本地优先**：降低校园赛与社区赛的部署门槛，并让赛事方长期掌控自己的制播工具。

## 核心边界

RivalHub Broadcast 不建立第二套官方赛事数据库，也不把实时观测直接当成官方事实。

```text
赛事上下文提供方
        ↓
   MatchContext
        ↓
CS2 数据源 → RuntimeState
                ├─ ProgramProjection
                ├─ RadarFrame
                ├─ OperatorProjection
                ├─ ObserverAssistProjection
                └─ DebugProjection
```

关键约束：

- 官方赛事事实与本地实时观测分权；
- Core 只有一份 ``RuntimeState``，不同消费面通过独立投影读取所需数据；
- 正式节目只消费 Program-safe 数据；
- Lookahead 的未来信息只进入观察辅助，不进入正式节目、OBS 正式输出或公开实时状态；
- 高频快照采用只保留最新值的有界投递，不积压旧状态；
- 数据源重连、进程重启、地图执行和比赛会话使用不同的连续性标识；
- Raw GSI 和第三方 CSTV parser 类型都被限制在各自适配器内；
- Renderer 不直接读取 Raw GSI、RivalHub API 或整个 ``RuntimeState``。

详细边界见 [`docs/architecture.md`](docs/architecture.md)。

## 本地界面

生产构建由 Companion 同时提供静态网页与本地 WebSocket：

```text
/program   正式节目画面
/operator  制作控制
/debug     运行诊断
```

默认监听：

```text
http://127.0.0.1:3000
```

开发环境的 Web 页面默认运行在：

```text
http://127.0.0.1:4173
```

非本机回环访问必须显式开启 ``LOCAL_WEB_LAN_MODE=1``，并通过 ``LOCAL_WEB_ALLOWED_ORIGINS`` 提供精确 Origin 允许列表。

正式节目使用本地协议 V1。当前 channel schema 版本以 [`packages/protocol/src/version.ts`](packages/protocol/src/version.ts) 为唯一代码来源；协议语义见 [`docs/protocol.md`](docs/protocol.md)。

## 仓库结构

```text
apps/
  companion/            本地服务、组合根、GSI/CSTV 接入、网页与协议承载
  web/                  正式节目、制作控制、运行诊断

packages/
  core/                 RuntimeState、连续性、身份、转换、投影
  protocol/             Broadcast 自有的本地线协议
  radar/                与前端框架无关的雷达领域逻辑
  rivalhub/             RivalHub 赛事上下文适配器
  telemetry-gsi/        Raw GSI 解析与标准化
  telemetry-cstv/       CSTV GameEvent 适配器
  testkit/              采集读取、重放、模拟和故障注入

docs/                   产品、架构、协议、验证和决策文档
fixtures/               可复现测试数据
scripts/                架构检查、CI、现场验收和维护工具
```

## 文档

- [`docs/product.md`](docs/product.md)：产品定义与需求。
- [`docs/architecture.md`](docs/architecture.md)：当前架构与 ownership。
- [`docs/protocol.md`](docs/protocol.md)：RivalHub 只读契约与本地协议。
- [`docs/telemetry.md`](docs/telemetry.md)：GSI / CSTV 数据语义。
- [`docs/development-validation.md`](docs/development-validation.md)：开发、CI 与真实环境验收模型。
- [`docs/roadmap.md`](docs/roadmap.md)：能力依赖与演进顺序。
- [`docs/references.md`](docs/references.md)：参考项目与复用边界。
- [`docs/terminology.md`](docs/terminology.md)：中文术语与用户可见文案规则。
- [`docs/decisions/`](docs/decisions/)：架构决策记录。
- [`docs/rfcs/`](docs/rfcs/)：尚未完全冻结的专项设计。

文档默认使用中文。代码标识符、协议字段、标准专名和第三方项目名保留原文；普通工程词汇不应无必要地泄露到用户界面或中文正文。

## 开发与验证

常用命令：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm architecture:check
pnpm visual:test
pnpm local-web:production-smoke
```

CI 根据改动面选择必要的验证通道；未知路径、工具链、工作流和 CI 规划器变更会默认执行完整验证。真实 Windows + CS2 + OBS 验收与普通自动化验证分开管理，详见 [`docs/development-validation.md`](docs/development-validation.md)。

## 许可证

RivalHub Broadcast 使用 **GNU Affero General Public License v3.0 only（AGPL-3.0-only）**。

直接第三方依赖及其许可证见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)。研究参考项目不等于本仓库包含其代码或资产，相关边界见 [`docs/references.md`](docs/references.md)。
