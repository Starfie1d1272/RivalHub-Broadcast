param(
    [switch]$WaitForStale,
    [int]$TimeoutSeconds = 35
)
. (Join-Path $PSScriptRoot 'common.ps1')

if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 300) { throw '超时时间必须在 1 到 300 秒之间' }
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$status = $null
do {
    $status = Invoke-QualificationApi -Method GET -Path '/qualification/status'
    if (-not $WaitForStale -or $status.freshness -eq 'stale') { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

if ($WaitForStale -and $status.freshness -ne 'stale') { throw "$TimeoutSeconds 秒内运行状态未进入已过期（数据仍未被判定为过期）" }
$service = if (Test-ProcessRunning -ProcessId ([int](Read-RunState).processId)) { '运行中' } else { '已停止' }
$gsi = switch ([string]$status.gsi) {
    'receiving' { '正在接收' }
    'silent' { '当前无新数据' }
    default { '尚未收到数据' }
}
$freshness = switch ([string]$status.freshness) {
    'fresh' { '正常' }
    'stale' { '已过期' }
    'awaiting' { '等待数据' }
    default { '未知' }
}
$recorder = if ([bool]$status.recorder.incomplete -or [string]$status.recorder.state -eq 'failed') { '异常' } else { '正常' }
$result = switch ([string]$status.result) {
    'PASS' { '通过' }
    'FAIL' { '失败' }
    default { '证据不足' }
}
Write-Output "本地制播服务：$service"
Write-Output "GSI：$gsi"
Write-Output "运行状态：$freshness"
Write-Output "地图执行编号：$([string]$status.mapEpoch)"
Write-Output "采集记录：$recorder"
Write-Output "最近有效数据年龄：$([string]$status.lastAcceptedFrameAgeMs) 毫秒"
Write-Output "最近场景标记：$([string]$status.lastMarker)"
Write-Output "现场验收结果：$result"
