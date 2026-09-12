# 参考项目与吸收边界

RivalHub Broadcast 不 fork 单一 HUD Manager。现有项目作为产品、架构、协议、性能和运维参考；真正进入代码库前仍需单独确认许可证与维护状态。

| 项目 | 主要学习点 | 不直接继承的部分 |
| --- | --- | --- |
| `drweissbrot/cs-hud` | 最小 GSI → local server → HUD/config/radar → Browser Source；local-first | 老旧技术结构与有限 scene/product model |
| `mortenlein/eon` | Waiting/Intermission/Result、Operator、Simulator、Radar、provisional analytics、Playwright | 不 fork 其逐步演化出的 monolithic GSI/server 结构 |
| `nsnsay/Zhenhai-HUD-Manager` | TypeScript workspace、`csgogsi`、grenade/smoke/inferno、上下层 Radar、listener lifecycle | App 本体许可证边界不清；不复制应用代码/资产，也不继承第二套 Team/Match DB |
| 旧 Void / Void-HUD-Overlay | 高频 pipeline 的性能反例 | `structuredClone` 全 payload + recursive traversal + producer>consumer backlog |
| Boltobserv | 专业 observer Radar、advanced player states、autozoom、observer advisory、上下层、z-height、utility、Browser/OBS 输出 | GPL-3.0 且实现技术栈较旧；不作为 sidecar/第二套 GSI runtime，不复制其应用实现 |
| Lexogrine Obserview | 独立 Radar UX、avatar marker、telestrator、跨电脑 drawing sync | GPL-3.0、依赖 LHM/csgogsi-socket 且技术栈较旧；作为 Radar 产品参考而非 runtime dependency |
| Lexogrine HUD Manager | 成熟 production UX、HUD package、panel/action、veto/camera/replay 生态 | Manager 本体为自有 EULA，不作为代码来源 |
| `lexogrine/cs2-react-hud` | 开源 HUD package / panel / action contract、custom radar/killfeed | 不让 LHM contract 成为内部 BroadcastState |
| JTs-Hud | BYOH、HUD package、GSI install、observer tooling、LHM compatibility | GPL Manager 不作为底座；其本地 Team/Player/Match DB 与 RivalHub 重复 |
| M3MONs/CS2-HUD | React overlay、固定 canvas、layout/theme、Radar interpolation、rAF hot path | Python/FastAPI 不是本项目默认 runtime 方向 |
| SHUD | OBS/scene/camera 的 production shell、LHM/OpenHUD compatibility | 公开源码不足以作为完整实现底座 |
| MulNX | 高级 observer/camera/cinematic、localhost API | injection/hook/`-insecure` 安全域不同，只考虑 future optional adapter |
| Excel2OBS | 赛事 BP 图卡逐步出现的操作体验 | Excel/OBS source mutation 中间层在 RivalHub 场景中没有必要 |
| MatchZy / CounterStrikeSharp | server-side game events、可靠的 kill/hurt/round/bomb 增强 telemetry | 不能要求所有比赛服务器必装，因此不能成为基础 HUD 前提 |
| ValveResourceFormat | Source 2 资源解析、未来地图/C4 baked data tooling | 不把完整 Viewer/.NET 应用塞入 Broadcast runtime |

## 复用原则

1. 优先复用明确 permissive 的小型 library，而不是 copy 整个应用。
2. 参考 UX/架构不等于复制源码。
3. GPL/AGPL 项目如果只作为研究参考，应保持 clean implementation；任何代码级复用都要单独评估许可证后果。
4. LHM Manager 等专有软件只做产品 benchmark。
5. 第三方内部类型不得成为 Broadcast 公共协议的 owner。
6. 已存在明确 owner 的共享基础设施应优先通过 adapter/provider 复用，而不是在 Broadcast 再维护一份真相。例如 Radar 依赖 `MapGeometryProvider`，当前默认实现计划复用 DAK `@cs2dak/maps` 的 calibration；Radar 自己仍拥有 marker、utility、autozoom、effect、renderer 等产品语义。

实际新增依赖时更新根目录 `THIRD-PARTY-NOTICES.md`。
