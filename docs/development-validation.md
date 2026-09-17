# 开发与平台验证模型

> 本文定义 RivalHub Broadcast 在日常开发、GitHub Actions 自动验证、Windows + CS2 + OBS 生产验收之间的职责边界。它回答“在哪里开发、在哪里自动验证、什么情况下才能真正验收”，而不是记录当前某台机器是否可用，也不替代具体 Issue 的测试规格。

## 1. 三类环境

本项目明确区分三种环境：

```text
Development environment
开发环境
→ 允许 macOS / Windows / Linux 上的跨平台开发

Automated validation environment
自动验证环境
→ GitHub Actions / CI：按 Issue 要求覆盖 Linux、macOS、Windows

Production acceptance environment
生产验收环境
→ Windows + CS2 spectator + OBS + 真实赛事配置
```

原则：**开发环境不需要等同生产环境，但生产环境要求必须被单独、明确地验收。**

GitHub-hosted Windows runner 只能证明自动化脚本在该 runner 上运行，不能替代真实 Windows + CS2 + OBS 验收。不能因为主要开发环境不是 Windows，就把所有 Windows 相关代码交给另一名开发者；也不能因为 CI 在 Windows 上通过，就认为真实赛事环境已经验收。

## 2. 四层验证

### Layer A — Deterministic / platform-independent

应尽可能在任意开发机和 CI 中完整验证：

- protocol / schema；
- RuntimeState / projector；
- Program-safe / Assist-private state partition；
- identity state machine；
- liveSession / producer instance / map epoch / runtime seq；
- source-local generation / sequence / alignment state；
- accumulator；
- scene policy；
- Radar framework-neutral math / geometry；
- latest-wins backpressure；
- reliable observation outbox state machine；
- recorder / replay / simulator；
- Program / Assist non-leak contract tests；
- 同一 ProgramProjection 在不同 host instance 下不产生 host-specific domain truth；
- RivalHub contract compatibility。

如果这些模块因为“没有 Windows”而无法开发或单测，优先检查是否错误耦合了平台/adapter。

### Layer B — Browser / local runtime

主要由跨平台开发与 CI 验证：

- Fastify Companion；
- local HTTP / WebSocket；
- `/operator` / `/program` / `/debug`；
- Program renderer 的 browser/dev host 与 OBS Browser Source host；
- Observer Assist 的 browser/debug prototype（若采用）；
- React HUD / Radar renderer；
- scene UI；
- reconnect / baseline snapshot；
- local cache；
- OBS Browser Source 基础兼容测试；
- Program 截图回归：以 `ubuntu-24.04` + 固定版本 Playwright Chromium 作为唯一基准环境；
- Program renderer 不依赖具体 browser/desktop host 才能表达正确业务语义。

Issue #32 的生产本地网页服务属于本层：同一 Fastify 实例提供 Vite 静态资源与 Local Protocol V1 WebSocket。普通浏览器、Vite 开发代理和未来 OBS Browser Source 都从当前页面 Origin 推导 `ws:`/`wss:` 地址。自动化验证应覆盖静态路由、子协议与 Origin 策略、初始状态与重连、发布端只保留最新状态（latest-wins）、缓冲区保护、心跳与关闭清理；这些测试不需要真实 CS2 或 OBS。`pnpm build` 后还必须运行 `pnpm local-web:production-smoke`，直接消费真实 `apps/web/dist`，验证 `/program` 返回实际 Vite HTML、带哈希的资源可访问，以及 Program WebSocket 能完成升级连接并发送初始状态；不能用 Vitest 内部另行构建来替代这一构建后组合冒烟检查。

非 Windows 环境可以用于早期 Browser Source 与普通浏览器 host 验证，但不能替代 Windows 生产验收。Program 视觉回归只维护一套正式基准：`ubuntu-24.04` 上由固定版本 Playwright 提供的 Chromium。本地 macOS/Windows 运行视觉测试只用于冒烟检查，不得更新正式基准。需要有意更新基准时使用 `pnpm visual:update`，并在提交前人工审阅 PNG 差异。视觉回归通过不能替代 Windows + CS2 + OBS 生产验收。任何透明置顶/鼠标穿透桌面 Overlay（Program 或 Assist）的真实窗口行为都属于 Windows 生产路径，不能用普通浏览器页面假装已验收。

因此 #32 不要求额外的真实环境验收门槛。真实 Windows + CS2 + OBS Browser Source 的重新加载、长时稳定运行、Program/Assist 捕获隔离与生产路径关闭仍由 #35 单独验收；CI 通过不能替代 Layer D 的真实证据。

### Layer C — Real CS2 / CSTV validation

需要可运行真实 CS2 或真实 CSTV/GOTV 输入的机器。该机器的首要职责是**提供真实输入与验收证据**，不默认成为整个 telemetry/runtime 模块的代码 owner。

Program GSI 至少覆盖：

- GSI cfg 安装与发现；
- 真实 current-observation / block-specific omission semantics；
- 真实 update cadence；
- warmup / freezetime / round start / round end；
- halftime / side switch；
- map end / map change；
- disconnect / reconnect；
- map/server restart；
- spectator / player identity；
- bomb / grenade / smoke / inferno 等实际字段行为。

Lookahead / CSTV 进入实现后还需覆盖：

- no-delay / delayed 两条输入确属 same match / map；
- source-local reconnect / generation；
- tick/effective-gap alignment；
- map change 后重新建立 alignment；
- wrong-match / stale source fail closed；
- event lead-time 分布与 cue scheduling。

### Layer D — Production acceptance

发布候选必须在真实赛事形态完成：

```text
Windows 11
+ CS2 delayed spectator
+ RivalHub Broadcast Companion
+ local Program Overlay
+ Program / Operator
+ official OBS Program host
+ 实际赛事配置

Observer Assist 启用时再加：
+ no-delay headless Lookahead feed
+ independent topmost Assist Overlay
```

当前首个 official OBS Program host 以 `/program` Browser Source 为基线。如果未来支持直接捕获独立 Program Overlay 或其它 host，该路径必须拥有自己的真实 Windows + OBS 验收证据，不能用 Browser Source 的通过结果替代。

重点验收：

- 完整 BO3/等价长时流程；
- wall-clock soak；
- CPU / memory / latency；
- queue 是否长期增长；
- Program Overlay 与 official OBS Program host 在相同 scene/projection 下语义一致；
- Program Overlay 的透明、topmost、click-through、DPI、多显示器与常见 CS2 窗口模式；
- OBS source/host reload；
- Companion restart；
- CS2 restart；
- 网络中断 / RivalHub 短暂不可达；
- wrong match / stale manifest；
- map restart / stale epoch；
- fallback / recovery runbook；
- Assist future fields 不进入 Program/#615；
- Program Overlay 与 Assist Overlay 为独立 surface/window；
- official OBS capture 不误录 topmost Assist；
- 若 OBS 直接捕获 Program Overlay，则验证 capture method 不会同时带入 Assist 或其它桌面内容；
- Lookahead 故障只降级 Assist；
- Program 故障不存在 Lookahead→Program fallback。

CI 绿灯不能替代 Layer D。

## 3. Issue 必须声明的平台要求

每个 execution Issue 都必须区分以下三项：

### Implementation environment

```text
Cross-platform
macOS-primary
Windows-specific
Other explicit environment
```

表示“代码可以在哪里实现”。

### Automated validation

按实际需要选择：

```text
Local deterministic tests
Linux CI
macOS CI
Windows CI
Cross-platform CI
```

表示“哪些自动化环境必须通过”。

### Real-environment acceptance gate

按任务选择：

```text
Not required
Real Windows
Windows + CS2
Windows + CSTV
Windows + OBS
Windows + CS2 + OBS
Windows + CS2/CSTV + OBS
```

表示“Issue/Release 是否仍欠生产环境证据”。

**能开发**与**能最终验收**是两回事。一个 Issue 可以在任意合适开发环境完成实现并进入 PR，同时明确等待 Windows acceptance；但如果该真实环境证据属于本 Issue 的 closing criteria，则在证据补齐前不能伪装成 Done。

## 4. Windows validation lane 的协作方式

默认采用：

```text
Feature owner
+ Platform validator
```

而不是按开发机操作系统切割 domain ownership。

示例：

```text
Issue: GSI normalization

Implementation owner:
  feature owner / Agent

Platform validator:
  有 Windows + CS2 环境的协作者

Evidence:
  unit/replay tests
  + real Windows CS2 capture / acceptance
```

只有明显 Windows-specific 的工作（例如 installer、GSI cfg 自动安装、Windows packaging/launcher、Program/Assist topmost/click-through window integration）适合整块由 Windows contributor 负责。

真实平台验证应尽量使用**明确 commit/build 对应的可复现 artifact 或标准 start workflow**。不要在 validator 机器上临时修改代码后，再把结果当成仓库某个 revision 的正式验收证据。

## 4.1 M1 Qualification Bundle

M1 的 Windows + CS2 平台验证使用绑定 exact git SHA 的 portable qualification bundle，不把 source checkout 当作现场主流程。bundle 由 `pnpm qualification:build` 从当前 revision 构建：使用 `pnpm deploy` 生成自包含的 production Companion，并携带与 workspace `engines` 一致的官方 Node 24 Windows x64 runtime。借用的 Windows 机器不需要安装 Git、pnpm 或 Node，也不允许现场改代码。

bundle 的稳定目录契约为：

```text
rivalhub-broadcast-qualification-<shortSHA>-win-x64/
  runtime/node.exe
  app/package.json
  app/dist/**
  app/node_modules/**
  scripts/{install-gsi,start,mark,check,stop}.ps1
  scripts/{qualification-supervisor.mjs,qualification-contract.json,verify-evidence.mjs}
  scripts/evidence/{contract,capture,scenario,checks,integrity,report,qualification}.mjs
  config/gamestate_integration_rivalhub_broadcast.cfg.template
  metadata/{artifact.json,SHA256SUMS}
  evidence/
  README.txt
```

现场首选打开 loopback-only 的 `/qualification` 页面完成一次连续的 Demo A → 在 CS2 中执行 `quit` → 等待机器自动观察到 stale → 页面确认已退出 CS2 → 开始下一场 → 重开 CS2 → Demo B 流程。页面背后的 qualification-only HTTP/PowerShell seam 负责有限 marker、显式 `ProgramRuntime.resetMapExecution()` 和自动证据采集；该 surface 不属于正式 Operator UI、HUD 或 Program/OBS 输出。`start.ps1` 自动生成并安装 canonical GSI cfg，并启动外层 `qualification-supervisor.mjs` 管理整个 run lifecycle。页面的“结束测试并导出结果”会先让 Companion graceful shutdown，随后由 supervisor 自动 finalize、verify、恢复原 GSI cfg，并在页面显示 `PASS`、`FAIL` 或 `INCONCLUSIVE` 及报告相对路径；`stop.ps1` 仅作为 supervisor 不可用时的 automation fallback。人工的 `cs2-closed` 是退出 CS2 的声明，机器的 `runtime-stale` 是 GSI 沉默事实；两者都必须发生在下一场 reset 之前，但不要求人工点击先于 stale。reset 后如果 Core 观察到可靠的非空 map-name change 并推进 map epoch，独立 verifier 会把它作为 Demo B 的合法 execution boundary。

每个 `demo-a-live` / `demo-b-live` marker 都必须携带同一时刻的 accepted observation（sequence、receivedAt、monotonic time、map epoch、runtime sequence、source generation、producer identity 与 freshness）。独立 verifier 会将该 observation 的 sequence/timestamp 与 Capture V1 frame 对应，并分别证明它位于 reset 前或 reset 后的 execution；仅凭 marker 加上 capture 中任意 frame 不能判定 production chain 通过。marker vocabulary、check keys、结果值、schema version 与 pinned Node runtime 位于仓库内的 `apps/companion/src/qualification/contract.json`，runtime evaluation 与 verifier evaluation 保持独立。

`next-execution` 的 after marker 还必须记录 `programTelemetryCleared: true`，由 reset 后真实 RuntimeSnapshot 计算；controller 与 offline verifier 都必须验证该事实，才能把 explicit reset 或 Demo B recovery 判为通过。页面展示的 qualification semantic result 与 GSI 配置恢复状态分开表达；恢复失败不能改写 `qualification.json` 或 `REPORT.md` 中已经冻结的核心验收结果。finalization/verification 失败时保留 `.qualification-local` 供诊断，不自动删除 supervisor 日志。

GSI 安装器会优先读取 Steam `libraryfolders.vdf`（并结合常见注册表安装路径），枚举 library 中的 CS2；`-Cs2Root` 仍是自动发现为零或多个候选时的明确 fallback。portable qualification runtime 当前固定为 contract 中声明的官方 Node Windows x64 版本，升级必须通过普通 PR 修改该配置。

仓库级验证入口为：

```text
pnpm qualification:build
pnpm qualification:offline
pnpm qualification:verify <evidence-dir-or-zip>
```

`qualification:offline` 在借用 Windows 机器前运行确定性测试、真实语义 fixture/replay、runtime/recorder/Companion integration 与 bundle structure smoke。Linux/macOS/Windows CI 的对应 job 只证明自动化与 bundle 脚本可执行；PR 的 Windows job 必须 checkout 并上传 PR head SHA 对应的 ZIP，且通过 automated gate 后才能作为真实 validator 的输入。GitHub-hosted Windows smoke 不等于真实 Windows + CS2 acceptance；后者仍须使用该 exact-revision artifact 完成独立的 Layer C/D 现场证据。

## 5. Real Telemetry Reference Corpus

第一批真实 Windows + CS2 observer capture 已经取得，并已经用于 `docs/telemetry.md` 的 evidence-backed semantics，包括 normal-player、observer、warmup/local-BOT 以及完整比赛生命周期的派生 evidence。

后续 reference corpus 的目标不再是“证明 GSI 存在”，而是补齐仍缺的生命周期和故障边界。优先补充：

```text
map end / map change
disconnect / reconnect
restart / restore（可稳定构造且有增量价值时）
长期 soak
production-like observer/GOTV shape（有差异证据时）
```

已经由 canonical semantic corpus 充分保护的场景不为了增加样本数量重复录制；新 capture 应服务于明确的 open validation question。

Lookahead 实现后另建 CSTV/alignment evidence：

```text
paired no-delay + delayed source
event tick / Program tick
alignment drift
source reconnect
gap loss / recovery
map change
```

每次真实 capture 至少记录：

- Windows version；
- CS2 build/version；
- GSI/CSTV configuration；
- capture timestamp；
- scenario notes；
- final hash / frame range / completeness；
- 是否含敏感 token / account data，进入仓库前必须 scrub/anonymize。

真实 capture 的目标是把昂贵、难重复的生产输入转换成可在开发机/CI 中持续 replay 的测试资产。原始私人 capture 不等于可直接提交仓库的 fixture。

## 6. 维护原则

本文只保留长期有效的环境分层、acceptance 规则与 evidence 采集原则。以下短期状态不在本文维护：

- 某台开发机当前是否可用；
- 某位协作者当前能否提供 Windows/CS2；
- 某周的录制安排、feature-freeze 日期或 sprint 计划；
- 已经完成的单次 capture/PR 执行过程。

这些内容放在对应 Milestone、Issue、PR 或 Project。若真实 evidence 改变了 source semantics 或长期 validation requirement，则在产生该变化的同一 PR 中更新本文件或 `docs/telemetry.md`。
