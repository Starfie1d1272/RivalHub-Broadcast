. (Join-Path $PSScriptRoot 'common.ps1')

$install = Read-InstallState
Write-GsiEndpointConflictWarning -CfgDirectory (Split-Path -Parent ([string]$install.cfgPath)) -CanonicalCfgPath ([string]$install.cfgPath) | Out-Null
$artifact = Read-JsonFile -Path (Join-Path $script:BundleRoot 'metadata\artifact.json')
$nodePath = Join-Path $script:BundleRoot 'runtime\node.exe'
$appPath = Join-Path $script:BundleRoot 'app'
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'bundle 内缺少 runtime\node.exe' }
if (-not (Test-Path -LiteralPath (Join-Path $appPath 'dist\server.js') -PathType Leaf)) { throw 'bundle 内缺少 Companion dist\server.js' }
$nodeModulesPath = Join-Path $appPath 'node_modules'
if (-not (Test-Path -LiteralPath $nodeModulesPath -PathType Container)) { throw 'bundle 内缺少 node_modules' }
$dependencyPath = Join-Path $nodeModulesPath '.pnpm\node_modules'

$listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) { throw '3000 端口已被占用；请先停止其他进程再开始 qualification' }

$runId = "$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$runDir = Join-Path $script:BundleRoot "evidence\$runId"
foreach ($directory in @($runDir, (Join-Path $runDir 'recorder'), (Join-Path $runDir 'debug'), (Join-Path $runDir 'logs'), (Join-Path $runDir 'cfg'))) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
New-Item -ItemType File -Force -Path (Join-Path $runDir 'scenario.jsonl') | Out-Null
Copy-Item -LiteralPath (Join-Path $script:BundleRoot 'metadata\artifact.json') -Destination (Join-Path $runDir 'artifact.json') -Force
Write-JsonFile -Path (Join-Path $runDir 'cfg\fingerprint.json') -Value ([ordered]@{
    schemaVersion = 1
    path = [string]$install.cfgPath
    sha256 = [string]$install.cfgFingerprint
})

$windowsVersion = 'unknown'
try { $windowsVersion = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption } catch { $windowsVersion = $env:OS }
$cs2Version = [string]$install.cs2Version
if ([string]::IsNullOrWhiteSpace($cs2Version)) { $cs2Version = 'unknown' }
Write-JsonFile -Path (Join-Path $runDir 'environment.json') -Value ([ordered]@{
    schemaVersion = 1
    runId = $runId
    windowsVersion = $windowsVersion
    cs2Version = $cs2Version
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
})

$controlToken = New-QualificationToken
$runState = [ordered]@{
    schemaVersion = 1
    runId = $runId
    runDir = $runDir
    gsiToken = [string]$install.gsiToken
    controlToken = $controlToken
    cfgPath = [string]$install.cfgPath
    backupPath = $install.backupPath
    hadExistingConfig = [bool]$install.hadExistingConfig
    artifactSha256 = [string]$artifact.artifactSha256
    processId = $null
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
}
Write-JsonFile -Path $script:RunStatePath -Value $runState

$env:BROADCAST_COMMIT = [string]$artifact.gitSha
$env:GSI_TOKEN = [string]$install.gsiToken
$env:CAPTURE_DIR = (Join-Path $runDir 'recorder')
$env:QUALIFICATION_MODE = 'true'
$env:QUALIFICATION_CONTROL_TOKEN = $controlToken
$env:QUALIFICATION_RUN_ID = $runId
$env:QUALIFICATION_SCENARIO_PATH = (Join-Path $runDir 'scenario.jsonl')
$env:QUALIFICATION_EVIDENCE_DIR = $runDir
$env:QUALIFICATION_BUNDLE_ROOT = $script:BundleRoot
$env:QUALIFICATION_APP_ROOT = $appPath
$env:QUALIFICATION_NODE_PATH = $nodePath
$env:QUALIFICATION_RUN_DIR = $runDir
$env:QUALIFICATION_RUN_STATE_PATH = $script:RunStatePath
$env:QUALIFICATION_FINALIZATION_PATH = (Join-Path $script:QualificationStateRoot 'finalization.json')
if (Test-Path -LiteralPath $dependencyPath -PathType Container) {
    $env:NODE_PATH = if ($env:NODE_PATH) { "$dependencyPath;$($env:NODE_PATH)" } else { $dependencyPath }
}

$supervisorPath = Join-Path $script:BundleRoot 'scripts\qualification-supervisor.mjs'
if (-not (Test-Path -LiteralPath $supervisorPath -PathType Leaf)) { throw 'bundle 内缺少 qualification supervisor 脚本' }
$supervisorLogPath = Join-Path $script:QualificationStateRoot 'supervisor.log'
$supervisorErrorPath = Join-Path $script:QualificationStateRoot 'supervisor.stderr.log'
$quotedSupervisorPath = '"' + $supervisorPath.Replace('"', '\"') + '"'
$supervisor = Start-Process -FilePath $nodePath -ArgumentList @($quotedSupervisorPath) -WorkingDirectory $script:BundleRoot -RedirectStandardOutput $supervisorLogPath -RedirectStandardError $supervisorErrorPath -WindowStyle Hidden -PassThru

$ready = $false
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if (-not (Test-ProcessRunning -ProcessId $supervisor.Id)) { throw "qualification supervisor 在服务就绪前退出；请查看 $supervisorErrorPath" }
    try {
        $health = Invoke-RestMethod -Method GET -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 2 -ErrorAction Stop
        if ($health.status -eq 'ok') { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 250
}
$runState = Read-RunState
if ($null -eq $runState.processId) { throw "未记录 Companion PID；请查看 $supervisorErrorPath" }
if (-not $ready) { throw "等待 Companion 就绪超过 30 秒；请查看 $supervisorErrorPath" }
$runState | Add-Member -NotePropertyName supervisorProcessId -NotePropertyValue ([int]$supervisor.Id) -Force
Write-JsonFile -Path $script:RunStatePath -Value $runState

Write-Output "Companion 正在运行（PID $([int]$runState.processId)）；supervisor PID $($supervisor.Id)"
Write-Output '请打开 http://127.0.0.1:3000/qualification 进入现场操作页面。'
Write-Output '页面是首选流程；Companion 退出后会完成 evidence。'
Write-Output 'check.ps1、mark.ps1 和 stop.ps1 仍可作为自动化备用入口。'
