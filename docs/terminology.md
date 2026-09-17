# 中文术语与界面语言

本仓库的一手文档、GitHub 协作表面和面向制作人员的界面默认使用中文。代码标识符、协议字段、环境变量、路径、第三方项目名和标准技术专名保持原文，以保证可搜索性和协议精确性。

## 原则

1. **中文先解释，原文用于精确指代。** 自然语言优先写“本机回环地址”，需要指向代码概念时再写 ``loopback``。
2. **不把内部枚举直接当界面文案。** 例如协议值 ``stale`` 在界面上显示为“比赛数据已停止”或“数据已过期”，而不是直接显示 ``stale``。
3. **协议值和代码符号不翻译。** ``ProgramProjection``、``schemaVersion``、``rivalhub-broadcast.local.v1`` 等必须保持精确。
4. **标准专名可以直接使用。** HTTP、WebSocket、OBS、GSI、CSTV、React、Vite、Playwright、Steam64 等无需强行翻译。
5. **面向开发者的文档也避免无必要中英混排。** 英文普通工程词有稳定中文表达时优先使用中文。

## 推荐用词

| 原文或代码概念 | 中文正文 / 用户界面 |
| --- | --- |
| Program | 正式节目；需要指代码概念时写 ``Program`` |
| Operator | 制作控制；需要指页面或类型时写 ``Operator`` |
| Observer Assist | 观察辅助（Observer Assist） |
| Broadcast Workspace | 制播工作区 |
| Runtime | 运行时 |
| projection | 投影；代码类型保留 ``*Projection`` |
| renderer | 渲染层 / 渲染器 |
| host | 承载环境 / 承载方式 |
| surface | 界面 / 显示面 |
| snapshot | 快照 |
| baseline | 基线 |
| production | 正式环境 / 生产环境 |
| validation | 验证；涉及真实环境通过条件时用“验收” |
| qualification | 现场验收；内部路径、脚本和环境变量保留 ``qualification`` |
| evidence | 证据 / 验收证据 |
| stale | 已过期 / 数据已停止；协议值仍为 ``stale`` |
| fresh | 正常 / 数据新鲜；协议值仍为 ``fresh`` |
| reset | 重置 |
| fallback | 降级 / 备用路径 |
| loopback | 本机回环 |
| allowlist | 允许列表 |
| lane | 数据通道 / 验证通道 |
| provider | 数据提供方 |
| adapter | 适配器 |
| source | 数据源 |
| latest-wins | 只保留最新值 |
| backpressure | 背压 |
| outbox | 可靠投递队列；代码概念保留 ``outbox`` |
| fail closed | 默认拒绝 / 安全关闭 |
| fixture | 测试样例；文件或代码名保留 ``fixture`` |
| replay | 重放 |
| capture | 采集记录；代码名保留 ``capture`` |
| marker | 场景标记；协议值保留原文 |

## 用户可见文本

以下内容必须使用清晰中文：

- 页面标题、按钮、状态、提示和错误说明；
- GitHub Issue / PR 模板的标题、标签和说明；
- Windows 现场验收页面、说明文件和命令行提示；
- 面向赛事工作人员的运行手册与报告。

Debug 页面可以展示原始 JSON、协议字段和内部枚举，但包围这些原始数据的标题、解释、状态和操作必须中文化。

## 代码与协议

以下内容不应因本地化而修改：

- TypeScript 类型、函数、类、包名；
- JSON / WebSocket / HTTP 协议字段和值；
- HTTP 路径、WebSocket 子协议、环境变量；
- GitHub Actions job id、脚本参数、CLI option；
- 第三方 API、项目名、许可证标识。

新增用户可见文案时，应先按本表选择中文表达；确实没有稳定译法的术语，再保留原文并在首次出现时说明含义。
