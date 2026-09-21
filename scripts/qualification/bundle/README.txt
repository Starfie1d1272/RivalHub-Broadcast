RivalHub Broadcast Windows 现场验收包

此验收包绑定 git SHA <SHORT_SHA>，并内置 Node <NODE_VERSION>。它用于验证真实 Windows + CS2 环境中的数据连续性与跨场恢复，不是产品安装程序。

快速开始：

1. 在此目录打开 PowerShell。
2. 执行：`powershell -ExecutionPolicy Bypass -File .\scripts\install-gsi.ps1`
   安装器会读取 Steam 库信息并寻找 CS2。若无法唯一定位，请使用 `-Cs2Root <path>` 指定 CS2 安装根目录或 `game\csgo\cfg`。
3. 执行：`powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1`
4. 打开 http://127.0.0.1:3000/qualification。
5. 按页面依次完成：播放 Demo A → 在 CS2 中执行 `quit` → 等待页面显示比赛数据已过期（即一段时间未收到新的有效数据）→ 确认已退出 CS2 → 开始下一场 → 重开 CS2 → 播放 Demo B → 导出结果。
6. 页面会自动整理并验证验收证据、恢复原 GSI 配置，然后显示“通过”“失败”或“证据不足”以及报告路径。
7. 最终证据写入 `evidence\<runId>\`；`REPORT.md` 是便于人工阅读的报告，`qualification.json` 是机器可读结果。

目标时钟的八类专项场景需要使用 `scripts\mark.ps1` 记录开始与结束。重连或接收端重启场景的操作顺序是：先记录 `-Phase before`，实际重连或重启接收端后执行 `scripts\rotate.ps1`，再记录 `-Phase after`。`rotate.ps1` 只会在同一轮现场验收中开始新的采集记录，不会新建验收轮次。

备用自动化命令：

  `powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 demo-a-live`
  `powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1 -WaitForStale`
  `powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 cs2-closed`
  `powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 cs2-reopened`
  `powershell -ExecutionPolicy Bypass -File .\scripts\stop.ps1`

验收服务只监听本机回环地址的 3000 端口。现场不需要、也不应修改代码或查看原始 JSON。
访问令牌与验收控制令牌不会写入最终报告。正常流程由验收管理进程负责结束服务、验证证据、恢复配置和清理临时状态；只有该流程不可用时，`stop.ps1` 才作为备用入口。
