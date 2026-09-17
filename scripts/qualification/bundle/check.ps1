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

if ($WaitForStale -and $status.freshness -ne 'stale') { throw "$TimeoutSeconds 秒内仍未确认比赛数据停止" }
$service = if (Test-ProcessRunning -ProcessId ([int](Read-RunState).processId)) { '运行中' } else { '已停止' }
$gsi = switch ([string]$status.gsi) {
    'receiving' { '正在接收' }
    'silent' { '数据已停止' }
    default { '尚未收到数据' }
}
$dataState = switch ([string]$status.freshness) {
    'fresh' { '正常' }
    'stale' { '已停止' }
    default { '等待中' }
}
$recording = if ([bool]$status.recorder.incomplete -or [string]$status.recorder.state -eq 'failed') { '异常' } else { '正常' }
$result = switch ([string]$status.result) {
    'PASS' { '通过' }
    'FAIL' { '失败' }
    default { '证据不足' }
}
Write-Output "本地制播服务：$service"
Write-Output "GSI 数据：$gsi"
Write-Output "比赛数据状态：$dataState"
Write-Output "地图执行序号：$([string]$status.mapEpoch)"
Write-Output "采集记录：$recording"
Write-Output "距最近一帧：$([string]$status.lastAcceptedFrameAgeMs) ms"
Write-Output "最近场景标记：$([string]$status.lastMarker)"
Write-Output "验收结果：$result"
