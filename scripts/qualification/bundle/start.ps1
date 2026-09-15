. (Join-Path $PSScriptRoot 'common.ps1')

$install = Read-InstallState
$artifact = Read-JsonFile -Path (Join-Path $script:BundleRoot 'metadata\artifact.json')
$nodePath = Join-Path $script:BundleRoot 'runtime\node.exe'
$appPath = Join-Path $script:BundleRoot 'app'
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'bundled runtime/node.exe is missing' }
if (-not (Test-Path -LiteralPath (Join-Path $appPath 'dist\server.js') -PathType Leaf)) { throw 'bundled Companion dist/server.js is missing' }

$listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) { throw 'port 3000 is already occupied; stop the other process before starting qualification' }

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
Write-JsonFile -Path (Join-Path $runDir 'environment.json') -Value ([ordered]@{
    schemaVersion = 1
    runId = $runId
    windowsVersion = $windowsVersion
    cs2Version = [string]$install.cs2Version
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

$stdoutPath = Join-Path $runDir 'logs\companion.log'
$stderrPath = Join-Path $runDir 'logs\companion.stderr.log'
$process = Start-Process -FilePath $nodePath -ArgumentList @('dist/server.js') -WorkingDirectory $appPath -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru
$runState.processId = $process.Id
Write-JsonFile -Path $script:RunStatePath -Value $runState

$ready = $false
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if (-not (Test-ProcessRunning -ProcessId $process.Id)) { throw "Companion exited before readiness; see $stderrPath" }
    try {
        $health = Invoke-RestMethod -Method GET -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 2 -ErrorAction Stop
        if ($health.status -eq 'ok') { $ready = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 250
}
if (-not $ready) { throw "Companion readiness timed out after 30 seconds; see $stderrPath" }

Write-Output "Companion RUNNING (PID $($process.Id))"
Write-Output 'Open http://127.0.0.1:3000/qualification for the operator page.'
Write-Output 'The page is the preferred workflow; check.ps1 and mark.ps1 remain automation fallbacks.'
