param(
    [switch]$WaitForStale,
    [int]$TimeoutSeconds = 35
)
. (Join-Path $PSScriptRoot 'common.ps1')

if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 300) { throw 'TimeoutSeconds must be between 1 and 300' }
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$status = $null
do {
    $status = Invoke-QualificationApi -Method GET -Path '/qualification/status'
    if (-not $WaitForStale -or $status.freshness -eq 'stale') { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

if ($WaitForStale -and $status.freshness -ne 'stale') { throw "runtime did not become stale within $TimeoutSeconds seconds" }
$companion = if (Test-ProcessRunning -ProcessId ([int](Read-RunState).processId)) { 'RUNNING' } else { 'STOPPED' }
$gsi = switch ([string]$status.gsi) {
    'receiving' { 'RECEIVING' }
    'silent' { 'SILENT' }
    default { 'NEVER_SEEN' }
}
$freshness = switch ([string]$status.freshness) {
    'fresh' { 'FRESH' }
    'stale' { 'STALE' }
    default { 'AWAITING' }
}
$recorder = if ([bool]$status.recorder.incomplete -or [string]$status.recorder.state -eq 'failed') { 'FAILED' } else { 'OK' }
Write-Output "Companion: $companion"
Write-Output "GSI: $gsi"
Write-Output "Runtime freshness: $freshness"
Write-Output "Map epoch: $([string]$status.mapEpoch)"
Write-Output "Recorder: $recorder"
Write-Output "Last accepted frame age: $([string]$status.lastAcceptedFrameAgeMs) ms"
Write-Output "Current scenario: $([string]$status.lastMarker)"
Write-Output "Qualification result: $([string]$status.result)"
