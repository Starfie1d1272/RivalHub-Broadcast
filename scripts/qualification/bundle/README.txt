RivalHub Broadcast Qualification Bundle

This bundle is bound to git SHA <SHORT_SHA> and embeds Node <NODE_VERSION>.
It is a portable M1 validation tool, not a product installer.

Quick start on Windows:

1. Open PowerShell in this directory.
2. powershell -ExecutionPolicy Bypass -File .\scripts\install-gsi.ps1
   Use -Cs2Root <path> when automatic Steam discovery finds zero or multiple cfg directories.
3. powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
4. Open http://127.0.0.1:3000/qualification.
5. Follow the page: Demo A -> stopdemo/close CS2 -> wait for stopped data -> Start next match -> reopen CS2 -> Demo B -> export.
6. The final evidence is written below evidence\<runId>\; REPORT.md and qualification.json are the handoff files.

Fallback automation commands:

  powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 demo-a-live
  powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 demo-a-stopped
  powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 cs2-closed
  powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1 -WaitForStale
  powershell -ExecutionPolicy Bypass -File .\scripts\mark.ps1 cs2-reopened
  powershell -ExecutionPolicy Bypass -File .\scripts\stop.ps1

The bundle only listens on loopback port 3000. Do not edit code or inspect raw JSON on the validator machine.
No GSI or qualification token is written to the final evidence report.
