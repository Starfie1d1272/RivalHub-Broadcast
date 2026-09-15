RivalHub Broadcast Qualification 验收 Bundle

此 bundle 绑定 git SHA <SHORT_SHA>，并内置 Node <NODE_VERSION>。它是便携式 M1 验收工具，不是产品安装程序。

Windows 现场快速开始：

1. 在此目录打开 PowerShell。
2. 执行：`powershell -ExecutionPolicy Bypass -File .\scripts\install-gsi.ps1`
   安装器会读取 Steam 库元数据并检查所有 CS2 库。
   如果自动发现的 cfg 目录为零个或多个，请使用 `-Cs2Root <path>` 明确指定路径。
3. 执行：`powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1`
4. 打开 http://127.0.0.1:3000/qualification。
5. 按页面完成：播放 Demo A → 在 CS2 中执行 `quit` → 等页面显示“比赛数据已停止” → 确认“我已退出 CS2” → 点击“开始下一场” → 重开 CS2 → 播放 Demo B → 导出结果。
6. 页面会等待 qualification supervisor 完成并验证 evidence，恢复原 GSI 配置，然后显示 `PASS`、`FAIL` 或 `INCONCLUSIVE` 以及报告路径。
7. 最终 evidence 写入 `evidence\<runId>\`；其中 `REPORT.md` 和 `qualification.json` 是交接文件。

备用自动化命令：

  `powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 demo-a-live`
  `powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1 -WaitForStale`
  `powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 cs2-closed`
  `powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 cs2-reopened`
  `powershell -ExecutionPolicy Bypass -File .\scripts\stop.ps1`

bundle 只监听 loopback 的 3000 端口。现场不需要、也不应修改代码或查看 raw JSON。
GSI token 和 qualification token 不会写入最终 evidence 报告。正常情况下由 supervisor 负责完成、验证、恢复配置和清理本地状态；只有 supervisor 不可用时，`stop.ps1` 才会接管 finalization fallback。
