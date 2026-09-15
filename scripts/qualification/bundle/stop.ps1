param([switch]$KeepGsiConfig)
. (Join-Path $PSScriptRoot 'common.ps1')

$state = Read-RunState
$runDir = [string]$state.runDir
$finalizationPath = Join-Path $script:QualificationStateRoot 'finalization.json'
$exitCode = 0
$supervisorCompleted = $false
try {
    try {
        $finalRuntime = Invoke-RestMethod -Method GET -Uri 'http://127.0.0.1:3000/debug/runtime' -TimeoutSec 3 -ErrorAction Stop
        Write-JsonFile -Path (Join-Path $runDir 'debug\final-runtime.json') -Value $finalRuntime
    } catch { Write-Output 'Final runtime snapshot unavailable; report will mark the affected check inconclusive.' }
    try {
        $finalHealth = Invoke-RestMethod -Method GET -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 3 -ErrorAction Stop
        Write-JsonFile -Path (Join-Path $runDir 'debug\final-health.json') -Value $finalHealth
    } catch { Write-Output 'Final health snapshot unavailable.' }

    try {
        $finish = Invoke-QualificationApi -Method POST -Path '/qualification/finish'
        Write-Output ([string]$finish.message)
    } catch {
        Write-Output 'Qualification finish route was unavailable; sending graceful process termination.'
        if (Test-ProcessRunning -ProcessId ([int]$state.processId)) { Stop-Process -Id ([int]$state.processId) }
    }

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline -and (Test-ProcessRunning -ProcessId ([int]$state.processId))) { Start-Sleep -Milliseconds 250 }
    if (Test-ProcessRunning -ProcessId ([int]$state.processId)) {
        Write-Error 'Companion did not stop within 45 seconds; forcing termination.'
        Stop-Process -Id ([int]$state.processId) -Force
        $exitCode = 1
    }

    $completion = $null
    $completionDeadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $completionDeadline) {
        if (Test-Path -LiteralPath $finalizationPath -PathType Leaf) {
            try {
                $candidate = Read-JsonFile -Path $finalizationPath
                if ([string]$candidate.status -eq 'complete') { $completion = $candidate; break }
            } catch { }
        }
        Start-Sleep -Milliseconds 250
    }
    if ($null -ne $completion) {
        $supervisorCompleted = $true
        Write-Output "Qualification result: $([string]$completion.result)"
        Write-Output "Report: $(Join-Path $script:BundleRoot ([string]$completion.reportPath))"
        if ([string]$completion.verification -ne 'passed') { $exitCode = 1; throw 'evidence verification failed' }
        if ([string]$completion.result -ne 'PASS') { $exitCode = 2 }
    } else {
        Write-Output 'Qualification supervisor completion was unavailable; running evidence finalization fallback.'
        $nodePath = Join-Path $script:BundleRoot 'runtime\node.exe'
        $evidenceScript = Join-Path $script:BundleRoot 'scripts\verify-evidence.mjs'
        & $nodePath $evidenceScript '--finish' $runDir
        if ($LASTEXITCODE -ne 0) { $exitCode = 1; throw 'evidence report generation failed' }
        & $nodePath $evidenceScript '--verify' $runDir
        if ($LASTEXITCODE -ne 0) { $exitCode = 1; throw 'evidence verification failed' }

        $qualification = Read-JsonFile -Path (Join-Path $runDir 'qualification.json')
        Write-Output "Qualification result: $([string]$qualification.result)"
        Write-Output "Report: $(Join-Path $runDir 'REPORT.md')"
        if ([string]$qualification.result -ne 'PASS') { $exitCode = 2 }
    }
    if ($supervisorCompleted) {
        try { Invoke-QualificationApi -Method POST -Path '/qualification/finalization/ack' | Out-Null } catch { }
    }
} catch {
    Write-Error $_
    $exitCode = if ($exitCode -eq 0) { 1 } else { $exitCode }
} finally {
    if (-not $KeepGsiConfig) {
        $currentState = $null
        try { $currentState = Read-RunState } catch { }
        if ($null -ne $currentState -and -not [bool]$currentState.gsiRestored) {
            try { Restore-InstalledGsiConfig -State $currentState } catch { Write-Error $_; $exitCode = 1 }
        }
    }
    if (Test-Path -LiteralPath $script:QualificationStateRoot -PathType Container) {
        $removed = $false
        for ($attempt = 0; $attempt -lt 40 -and -not $removed; $attempt++) {
            if (-not (Test-Path -LiteralPath $script:QualificationStateRoot -PathType Container)) {
                $removed = $true
                break
            }
            try {
                Remove-Item -LiteralPath $script:QualificationStateRoot -Recurse -Force -ErrorAction Stop
                $removed = $true
            } catch {
                if (-not (Test-Path -LiteralPath $script:QualificationStateRoot -PathType Container)) {
                    $removed = $true
                } elseif ($attempt -eq 39) { Write-Error $_; $exitCode = 1 }
                else { Start-Sleep -Milliseconds 250 }
            }
        }
    }
}
exit $exitCode
