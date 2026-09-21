param([switch]$KeepGsiConfig)
. (Join-Path $PSScriptRoot 'common.ps1')

function Get-ResultLabel {
    param([string]$Result)
    switch ($Result) {
        'PASS' { return '通过' }
        'FAIL' { return '失败' }
        default { return '证据不足' }
    }
}

$state = Read-RunState
$runDir = [string]$state.runDir
$finalizationPath = Join-Path $script:QualificationStateRoot 'finalization.json'
$exitCode = 0
$fallbackOwner = $false
$fallbackVerificationPassed = $false
$fallbackCleanupPassed = $true
try {
    try {
        $finalRuntime = Invoke-RestMethod -Method GET -Uri 'http://127.0.0.1:3000/debug/runtime' -TimeoutSec 3 -ErrorAction Stop
        Write-JsonFile -Path (Join-Path $runDir 'debug\final-runtime.json') -Value $finalRuntime
    } catch { Write-Output '无法获取最终运行状态；报告会将受影响的检查标为证据不足。' }
    try {
        $finalHealth = Invoke-RestMethod -Method GET -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 3 -ErrorAction Stop
        Write-JsonFile -Path (Join-Path $runDir 'debug\final-health.json') -Value $finalHealth
    } catch { Write-Output '无法获取最终健康状态。' }

    try {
        $finish = Invoke-QualificationApi -Method POST -Path '/qualification/finish'
        Write-Output ([string]$finish.message)
    } catch {
        Write-Output '现场验收完成接口不可用；正在优雅终止本地制播服务进程。'
        if (Test-ProcessRunning -ProcessId ([int]$state.processId)) { Stop-Process -Id ([int]$state.processId) }
    }

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline -and (Test-ProcessRunning -ProcessId ([int]$state.processId))) { Start-Sleep -Milliseconds 250 }
    if (Test-ProcessRunning -ProcessId ([int]$state.processId)) {
        Write-Error '本地制播服务在 45 秒内未停止；正在强制终止。'
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
        Write-Output "现场验收结果：$(Get-ResultLabel -Result ([string]$completion.result))"
        Write-Output "报告：$(Join-Path $script:BundleRoot ([string]$completion.reportPath))"
        if ([string]$completion.verification -ne 'passed') { $exitCode = 1; throw '验收证据验证失败' }
        if ([string]$completion.cleanup -eq 'failed') {
            Write-Error 'GSI 配置恢复失败；现场验收本地状态已保留，供诊断使用。'
            $exitCode = 1
        } elseif ([string]$completion.result -ne 'PASS') {
            $exitCode = 2
        }
    } else {
        $supervisorProcessId = $null
        if ($state.PSObject.Properties.Name -contains 'supervisorProcessId') {
            $supervisorProcessId = $state.supervisorProcessId
        }
        if ($null -ne $supervisorProcessId -and [int]$supervisorProcessId -gt 0 -and (Test-ProcessRunning -ProcessId ([int]$supervisorProcessId))) {
            throw "验收管理进程仍在运行，不能安全执行最终收尾备用流程。请查看 $finalizationPath 和 supervisor.log"
        }
        $fallbackOwner = $true
        Write-Output '验收管理进程未提供完成状态；正在执行验收证据完成备用流程。'
        $nodePath = Join-Path $script:BundleRoot 'runtime\node.exe'
        $evidenceScript = Join-Path $script:BundleRoot 'scripts\verify-evidence.mjs'
        & $nodePath $evidenceScript '--finish' $runDir
        if ($LASTEXITCODE -ne 0) { $exitCode = 1; throw '验收报告生成失败' }
        & $nodePath $evidenceScript '--verify' $runDir
        if ($LASTEXITCODE -ne 0) { $exitCode = 1; throw '验收证据验证失败' }

        $qualification = Read-JsonFile -Path (Join-Path $runDir 'qualification.json')
        $fallbackVerificationPassed = $true
        Write-Output "现场验收结果：$(Get-ResultLabel -Result ([string]$qualification.result))"
        Write-Output "报告：$(Join-Path $runDir 'REPORT.md')"
        if ([string]$qualification.result -ne 'PASS') { $exitCode = 2 }
    }
    if (-not $fallbackOwner) {
        try { Invoke-QualificationApi -Method POST -Path '/qualification/finalization/ack' | Out-Null } catch { }
    }
} catch {
    Write-Error $_
    $exitCode = if ($exitCode -eq 0) { 1 } else { $exitCode }
} finally {
    if ($fallbackOwner -and -not $KeepGsiConfig) {
        $currentState = $null
        try { $currentState = Read-RunState } catch { }
        if ($null -ne $currentState -and -not [bool]$currentState.gsiRestored) {
            try {
                Restore-InstalledGsiConfig -State $currentState
                $currentState | Add-Member -NotePropertyName gsiRestored -NotePropertyValue $true -Force
                Write-JsonFile -Path $script:RunStatePath -Value $currentState
            } catch {
                Write-Error $_
                $fallbackCleanupPassed = $false
                $exitCode = 1
            }
        }
    }
    if ($fallbackOwner -and $fallbackVerificationPassed -and $fallbackCleanupPassed -and (Test-Path -LiteralPath $script:QualificationStateRoot -PathType Container)) {
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
                } elseif ($attempt -eq 39) { Write-Error $_; $fallbackCleanupPassed = $false; $exitCode = 1 }
                else { Start-Sleep -Milliseconds 250 }
            }
        }
    }
    if ($fallbackOwner -and (-not $fallbackVerificationPassed -or -not $fallbackCleanupPassed)) {
        Write-Output '现场验收本地状态已保留，供诊断使用。'
    }
}
exit $exitCode
