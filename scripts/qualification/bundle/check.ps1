param(
    [switch]$WaitForStale,
    [int]$TimeoutSeconds = 35
)
. (Join-Path $PSScriptRoot 'common.ps1')

if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 300) { throw 'TimeoutSeconds 必须在 1 到 300 之间' }
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$status = $null
do {
    $status = Invoke-QualificationApi -Method GET -Path '/qualification/status'
    if (-not $WaitForStale -or $status.freshness -eq 'stale') { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

if ($WaitForStale -and $status.freshness -ne 'stale') { throw "$TimeoutSeconds 秒内 runtime 未进入 stale" }
$companion = if (Test-ProcessRunning -ProcessId ([int](Read-RunState).processId)) { '运行中' } else { '已停止' }
$gsi = switch ([string]$status.gsi) {
    'receiving' { '接收中' }
    'silent' { '已静默' }
    default { '尚未收到' }
}
$freshness = switch ([string]$status.freshness) {
    'fresh' { 'fresh' }
    'stale' { 'stale' }
    default { '等待中' }
}
$recorder = if ([bool]$status.recorder.incomplete -or [string]$status.recorder.state -eq 'failed') { '失败' } else { '正常' }
Write-Output "Companion：$companion"
Write-Output "GSI：$gsi"
Write-Output "Runtime 新鲜度：$freshness"
Write-Output "Map epoch：$([string]$status.mapEpoch)"
Write-Output "Recorder 状态：$recorder"
Write-Output "最近 accepted frame 年龄：$([string]$status.lastAcceptedFrameAgeMs) ms"
Write-Output "当前场景：$([string]$status.lastMarker)"
Write-Output "Qualification 结果：$([string]$status.result)"
