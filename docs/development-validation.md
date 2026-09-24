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
- `/program` / `/operator` / `/debug`；
- `/operator/hud` 的三类配置工作区、共享 `GameplayHud` 预览与 HUD ETag conditional polling；
- 浏览器 reconnect；
- current baseline；
- Origin / subprotocol / LAN policy；
- Program 视觉回归；
- production web smoke。

Program 视觉回归只维护一套正式基准：固定版本 Playwright Chromium + `ubuntu-24.04`。仓库只提交 `tests/visual/__screenshots__/linux/`；Darwin / Windows 本地截图属于临时预览，不是正式 baseline，也不应提交。

视觉验证区分两个生命周期：

- **Draft PR = 设计探索。** visual job 使用 `pnpm visual:update` 在 Ubuntu / Chromium 上实际渲染全部视觉场景，并上传 `visual-candidates-<SHA>` artifact。截图与旧 baseline 不同本身不是失败；渲染错误、非截图断言失败仍会使 job 失败。
- **Ready PR / main = 验收。** visual job 使用 `pnpm visual:test` 严格比较 canonical Linux baseline。准备定稿时，不要求开发者在 macOS 或虚拟机生成 Linux 截图；直接在目标分支手工运行 **Approve visual baseline** workflow，由 Ubuntu runner 生成并提交新的 canonical baseline，然后 Ready PR 再接受严格回归。

因此 visual baseline 表达“已经批准的设计”，不是设计探索期间的工作草稿。只有准备把视觉状态作为可回归产品事实时才更新 baseline；普通 CSS / composition 探索无需先制造一次预期失败再上传截图。

Gameplay visual acceptance is real-first. Normal Program/HUD states must use generated real-derived Program fixtures whenever committed capture evidence exists. Synthetic fixtures are reserved for explicit edge/fail-closed or presentation stress and must declare provenance/reason.

真实 Program fixture 经 production adapter、ProgramRuntime 和 ProjectionCoordinator 生成，包含 capture 路径、目标 sequence 和来源 hash。数据更新流程仍为：提交 capture → `pnpm fixtures:program:generate` → 审查 Program snapshot diff。视觉探索在 Draft PR 直接审查 CI candidate artifact；视觉定稿时运行 **Approve visual baseline**，再由 `pnpm visual:test` 验证。展示压力测试只覆盖文案、logo、选手 avatarUrl 与赛制展示；头像验收使用确定性本地/data-URI 图片，加载失败由组件测试验证；游戏事实来自真实 fixture。CI 使用 `pnpm fixtures:program:verify` 检测生成产物漂移，验证命令不写入文件。

### C. 真实 CS2 / CSTV

覆盖：

- GSI cfg 安装与发现；
- planting / planted / defusing overloaded countdown semantics；
- objective timing qualification report 与真实 Capture V1 cadence / residual evidence；
- qualification measurement、provenance、scenario coverage 与独立 CSTV/demo reference gate；
- Production Capture Recorder 的 raw provenance、capture clock origin、objective reference
  contract 与显式 8 场景 marker；sanitized fixture 不能作为 production PASS；
- observer payload；
- update cadence；
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

只修改 `docs/**` 或 Markdown / MDX：

```text
planner + ci-gate
```

不运行 quality / visual / platform / qualification。

### 普通代码

`apps/`、`packages/`、`tests/`、`scripts/` 的已知路径至少进入 quality。Web / Program 相关路径额外运行 visual；Companion、telemetry 和 scripts 等平台敏感路径运行 platform。

### 现场验收敏感路径

`scripts/qualification/`、`apps/companion/src/qualification/` 和 GSI cfg 模板会触发 Windows qualification artifact / portable smoke。

### 默认完整验证

以下情况 fail closed 到 full CI：

- 未知或无法分类路径；
- rename / delete 等不安全 diff status；
- `.github/**`；
- CI planner 自身；
- lockfile / workspace / package manifest；
- TypeScript / ESLint / Vitest / Playwright 等工具链配置。

非 PR 事件使用完整验证，并包含 offline qualification。

CS2 asset import 是维护者本地资源工作流：CI 不安装 CS2、不下载 VPK、不运行 extraction，只验证 checked-in `@rivalhub-broadcast/cs2-assets` catalog、manifest、SVG hash、public output 与 resolver contract。首次生成或更新 asset 时，必须使用 `pnpm cs2-assets:import` 的 pinned Source2Viewer-CLI，并把 Steam build ID、source/output hash 和工具版本提交在 manifest 中。

`ci-gate` 是稳定 required context；条件 job 本身不需要全部设成 branch required check。

## 4. 自动化主入口

常规仓库验证：

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm fixtures:program:verify
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

HUD 控制台的视觉验证必须同时检查测试场景选择、Current Live 在没有已接收初始状态时 disabled、已选 Current Live 在 stale/重连/协议错误时保持选择但 fail-closed、新初始状态恢复后继续 live、编辑层拖动/尺寸控件、品牌色十六进制输入、三套草稿跨工作区保留，以及正式节目路由不包含编辑辅助层；还要验证 preset/appearance 只为未实现组件显示占位，layout 工作区才提供选择/拖动/resize chrome。严格截图断言只使用 canonical Linux / Chromium baseline；其它平台只做本地预览或浏览器冒烟。视觉测试中的 fixture 不是生产 telemetry，也不能作为当前实时来源失效时的 fallback。

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
