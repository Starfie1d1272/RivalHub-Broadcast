param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('demo-a-live', 'cs2-closed', 'cs2-reopened', 'demo-b-live')]
    [string]$Marker
)
. (Join-Path $PSScriptRoot 'common.ps1')

$response = Invoke-QualificationApi -Method POST -Path '/qualification/marker' -Body @{ kind = $Marker }
Write-Output ([string]$response.message)
