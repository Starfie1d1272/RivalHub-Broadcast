param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet(
        'demo-a-live', 'cs2-closed', 'cs2-reopened', 'demo-b-live',
        'objective-freezetime-live', 'objective-plant-abort', 'objective-planted-explode',
        'objective-defuse-kit-abort-restart', 'objective-defuse-no-kit-abort-restart',
        'objective-too-late-defuse', 'objective-fast-defuse-missing-planted-sample',
        'objective-reconnect-restart'
    )]
    [string]$Marker,
    [ValidateSet('before', 'after')]
    [string]$Phase
)
. (Join-Path $PSScriptRoot 'common.ps1')

$objectiveMarker = $Marker.StartsWith('objective-')
if ($objectiveMarker -and [string]::IsNullOrWhiteSpace($Phase)) {
    throw '目标时钟场景标记必须使用 -Phase 指定“开始”或“结束”。'
}
if (-not $objectiveMarker -and -not [string]::IsNullOrWhiteSpace($Phase)) {
    throw '只有目标时钟场景标记可以使用 -Phase。'
}
$body = @{ kind = $Marker }
if ($objectiveMarker) { $body.phase = $Phase }
$response = Invoke-QualificationApi -Method POST -Path '/qualification/marker' -Body $body
Write-Output ([string]$response.message)
