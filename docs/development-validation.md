# 开发、CI 与真实环境验收

本文定义“在哪里开发”“自动化证明什么”“真实赛事环境还需要证明什么”。三者不能互相替代。

## 1. 三类环境

```text
开发环境
  macOS / Windows / Linux
        ↓
自动化验证
  GitHub Actions + deterministic tests
        ↓
真实环境验收
  Windows + CS2/CSTV + OBS
```

开发环境不需要复制生产环境；真实环境要求也不能因为 CI 通过而被省略。

## 2. 验证层级

### A. 确定性领域与协议

任意开发机和 CI 都应尽量覆盖：

- RuntimeState / RuntimeTransition；
- objective clock anchor、map/source reset、defuse kit evidence 与 short-lease expiry；
- identity / session / map epoch；
- source continuity；
- gap-resync / stale-recovery objective anchor invalidation；
- Program / Assist non-leak；
- projection 与 wire schema；
- Radar 数学；
- latest-wins 背压；
- replay / fault injection；
- RivalHub contract validation；
- architecture guard。

如果这些测试必须依赖真实 Windows 或 CS2，优先检查是否错误耦合了平台实现。

### B. Browser / local runtime

覆盖：

- Fastify Companion；
- 静态网页与本地 WebSocket；
- ``/program`` / ``/operator`` / ``/debug``；
- 浏览器 reconnect；
- current baseline；
- Origin / subprotocol / LAN policy；
- Program 视觉回归；
- production web smoke。

Program 视觉回归只维护一套正式基准：固定版本 Playwright Chromium + ``ubuntu-24.04``。其它本地平台运行视觉测试只用于冒烟，不更新正式基准。

### C. 真实 CS2 / CSTV

覆盖：

- GSI cfg 安装与发现；
- observer payload；
- update cadence；
- planting / planted / defusing overloaded countdown semantics；
- objective timing qualification report 与真实 Capture V1 cadence / residual evidence；
- qualification measurement、provenance、scenario coverage 与独立 CSTV/demo reference gate；
- 回合与地图生命周期；
- stale / reconnect；
- source generation；
- paired no-delay / delayed CSTV；
- alignment drift 与恢复。

### D. Windows + OBS 正式验收

覆盖：

- 长时间比赛流程；
- CPU / memory / latency；
- Program Browser Source；
- reload / restart；
- DPI、多显示器和窗口模式；
- 本机 Program host 与 OBS 的语义一致性；
- Assist 私有显示不进入正式 Program capture；
- Lookahead 故障只降级 Assist；
- fallback / recovery runbook。

CI 绿灯不能替代 D 层。

## 3. PR 风险规划器

PR 使用 changed-surface planner，只运行与改动面匹配的证据。

### 仅文档改动

只修改 ``docs/**`` 或 Markdown / MDX：

```text
planner + ci-gate
```

不运行 quality / visual / platform / qualification。

### 普通代码

``apps/``、``packages/``、``tests/``、``scripts/`` 的已知路径至少进入 quality。Web / Program 相关路径额外运行 visual；Companion、telemetry 和 scripts 等平台敏感路径运行 platform。

### 现场验收敏感路径

``scripts/qualification/``、``apps/companion/src/qualification/`` 和 GSI cfg 模板会触发 Windows qualification artifact / portable smoke。

### 默认完整验证

以下情况 fail closed 到 full CI：

- 未知或无法分类路径；
- rename / delete 等不安全 diff status；
- ``.github/**``；
- CI planner 自身；
- lockfile / workspace / package manifest；
- TypeScript / ESLint / Vitest / Playwright 等工具链配置。

非 PR 事件使用完整验证，并包含 offline qualification。

CS2 asset import 是维护者本地资源工作流：CI 不安装 CS2、不下载 VPK、不运行 extraction，只验证 checked-in `@rivalhub-broadcast/cs2-assets` catalog、manifest、SVG hash、public output 与 resolver contract。首次生成或更新 asset 时，必须使用 `pnpm cs2-assets:import` 的 pinned Source2Viewer-CLI，并把 Steam build ID、source/output hash 和工具版本提交在 manifest 中。

``ci-gate`` 是稳定 required context；条件 job 本身不需要全部设成 branch required check。

## 4. 自动化主入口

常规仓库验证：

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm architecture:check
pnpm visual:test
pnpm local-web:production-smoke
```

现场验收工具：

```text
pnpm qualification:build
pnpm qualification:offline
pnpm qualification:objective-timing <capture-dir>
pnpm qualification:verify <evidence-dir-or-zip>
```

具体 PR 由 planner 选择子集；手工排查时可直接运行需要的完整命令。

## 5. Windows + CS2 现场验收包

真实 CS2 输入使用绑定 exact git SHA 的便携式 Windows 验收包。目标机不需要安装 Git、pnpm 或 Node，也不在现场改代码。

稳定结构：

```text
rivalhub-broadcast-qualification-<shortSHA>-win-x64/
  runtime/node.exe
  app/
  scripts/
  config/
  metadata/
  evidence/
  README.txt
```

标准流程：

```text
安装 GSI 配置
→ 启动验收服务
→ 打开 /qualification
→ 播放第一场
→ 退出 CS2 并观察数据停止
→ 开始下一场执行
→ 重开 CS2 并播放第二场
→ 导出并验证验收证据
→ 恢复原 GSI 配置
```

机器观测到的数据停止与人工声明“已退出 CS2”是两个不同证据；二者都必须在下一场 reset 前成立。

最终结果由独立 verifier 重新核对 capture、marker、runtime 与完整性哈希，不能只相信页面按钮状态。

## 6. 验收结果

机器 contract 使用：

```text
PASS
FAIL
INCONCLUSIVE
```

用户界面对应显示：

```text
通过
失败
证据不足
```

环境恢复状态与核心语义验收结果分开记录。恢复 GSI 配置失败不能篡改已经冻结的核心验收结果。

## 7. 证据原则

真实环境证据必须绑定：

- git SHA / artifact；
- Windows version；
- CS2 version；
- 输入配置；
- 场景说明；
- 时间与完整性哈希；
- 对应报告。

真实平台验证者使用仓库产生的 artifact，不在目标机临时改代码后把结果归因给另一个 revision。

## 8. 协作模型

默认使用：

```text
功能负责人
+ 平台验证者
```

平台验证者负责提供真实环境证据，不因此成为整个 telemetry/runtime 模块的代码 owner。

只有 installer、Windows packaging、topmost/click-through window 等平台本身就是功能语义的工作，才适合把实现 ownership 整体交给 Windows-specific contributor。
