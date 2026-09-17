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

if ($WaitForStale -and $status.freshness -ne 'stale') { throw "$TimeoutSeconds 秒内 runtime 未进入 stale（数据仍未被判定为过期）" }
$service = if (Test-ProcessRunning -ProcessId ([int](Read-RunState).processId)) { '运行中' } else { '已停止' }
$gsi = switch ([string]$status.gsi) {
    'receiving' { '正在接收（receiving）' }
    'silent' { '当前无新数据（silent）' }
    default { '尚未收到数据' }
}
$freshness = switch ([string]$status.freshness) {
    'fresh' { '正常（fresh）' }
    'stale' { '已过期（stale）' }
    default { '等待中' }
}
$recorder = if ([bool]$status.recorder.incomplete -or [string]$status.recorder.state -eq 'failed') { '异常' } else { '正常' }
$result = switch ([string]$status.result) {
    'PASS' { '通过（PASS）' }
    'FAIL' { '失败（FAIL）' }
    default { '证据不足（INCONCLUSIVE）' }
}
Write-Output "Companion（本地制播服务）：$service"
Write-Output "GSI：$gsi"
Write-Output "Runtime freshness：$freshness"
Write-Output "mapEpoch：$([string]$status.mapEpoch)"
Write-Output "Recorder：$recorder"
Write-Output "最近 accepted frame 年龄：$([string]$status.lastAcceptedFrameAgeMs) ms"
Write-Output "最近 marker：$([string]$status.lastMarker)"
Write-Output "Qualification 结果：$result"
