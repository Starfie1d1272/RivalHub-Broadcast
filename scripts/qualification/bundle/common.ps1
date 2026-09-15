Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:BundleRoot = Split-Path -Parent $PSScriptRoot
$script:QualificationStateRoot = Join-Path $script:BundleRoot '.qualification-local'
$script:InstallStatePath = Join-Path $script:QualificationStateRoot 'install.json'
$script:RunStatePath = Join-Path $script:QualificationStateRoot 'run.json'

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "missing JSON file: $Path" }
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )
    Write-Utf8NoBom -Path $Path -Content (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine)
}

function New-QualificationToken {
    $bytes = [byte[]]::new(32)
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Read-InstallState {
    return Read-JsonFile -Path $script:InstallStatePath
}

function Read-RunState {
    return Read-JsonFile -Path $script:RunStatePath
}

function Invoke-QualificationApi {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        $Body
    )
    $state = Read-RunState
    $headers = @{ 'x-qualification-token' = [string]$state.controlToken }
    $request = @{
        Method = $Method
        Uri = "http://127.0.0.1:3000$Path"
        Headers = $headers
        ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
        $request.ContentType = 'application/json'
        $request.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }
    return Invoke-RestMethod @request
}

function Test-ProcessRunning {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        return -not $process.HasExited
    } catch {
        return $false
    }
}

function Restore-InstalledGsiConfig {
    param($State)
    if ($null -eq $State -or $null -eq $State.cfgPath) { return }
    $cfgPath = [string]$State.cfgPath
    if ([bool]$State.hadExistingConfig) {
        if ($null -eq $State.backupPath -or -not (Test-Path -LiteralPath $State.backupPath -PathType Leaf)) {
            throw "cannot restore the original GSI config: backup is missing"
        }
        Copy-Item -LiteralPath $State.backupPath -Destination $cfgPath -Force
    } elseif (Test-Path -LiteralPath $cfgPath -PathType Leaf) {
        Remove-Item -LiteralPath $cfgPath -Force
    }
    if ($null -ne $State.backupPath -and (Test-Path -LiteralPath $State.backupPath -PathType Leaf)) {
        Remove-Item -LiteralPath $State.backupPath -Force
    }
}
