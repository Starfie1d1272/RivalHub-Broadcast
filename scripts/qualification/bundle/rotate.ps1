. (Join-Path $PSScriptRoot 'common.ps1')

$response = Invoke-QualificationApi -Method POST -Path '/qualification/recorder/rotate'
Write-Output ("已开始新的采集记录：旧编号 $([string]$response.previousCaptureId) -> 新编号 $([string]$response.captureId)")
