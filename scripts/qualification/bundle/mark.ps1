param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet(
        'demo-a-live', 'cs2-closed', 'cs2-reopened', 'demo-b-live',
        'objective-freezetime-live', 'objective-plant-abort', 'objective-planted-explode',
        'objective-defuse-kit-abort-restart', 'objective-defuse-no-kit-abort-restart',
        'objective-too-late-defuse', 'objective-fast-defuse-missing-planted-sample',
        'objective-reconnect-restart'
    )]
    [string]$Marker
    [ValidateSet('before', 'after')]
    [string]$Phase
)
. (Join-Path $PSScriptRoot 'common.ps1')

$objectiveMarker = $Marker.StartsWith('objective-')
if ($objectiveMarker -and [string]::IsNullOrWhiteSpace($Phase)) {
    throw 'objective 场景 marker 必须指定 -Phase before 或 -Phase after'
}
if (-not $objectiveMarker -and -not [string]::IsNullOrWhiteSpace($Phase)) {
    throw '只有 objective 场景 marker 可以指定 -Phase'
}
$body = @{ kind = $Marker }
if ($objectiveMarker) { $body.phase = $Phase }
$response = Invoke-QualificationApi -Method POST -Path '/qualification/marker' -Body $body
Write-Output ([string]$response.message)
