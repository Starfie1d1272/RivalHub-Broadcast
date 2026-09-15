param([string]$Cs2Root)
. (Join-Path $PSScriptRoot 'common.ps1')

function Resolve-CfgDirectory {
    param([string]$ExplicitRoot)
    if ($ExplicitRoot) {
        $resolved = (Resolve-Path -LiteralPath $ExplicitRoot -ErrorAction Stop).Path
        $leaf = Split-Path -Leaf $resolved
        if ($leaf -ieq 'cfg' -and (Test-Path -LiteralPath $resolved -PathType Container)) { return $resolved }
        $candidates = @(
            (Join-Path $resolved 'game\csgo\cfg'),
            (Join-Path $resolved 'csgo\cfg'),
            (Join-Path $resolved 'cfg')
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -Unique
        if ($candidates.Count -eq 1) { return [string]$candidates[0] }
        throw "无法从 -Cs2Root 找到唯一的 CS2 cfg 目录，请传入 game\csgo\cfg 或 CS2 安装根目录"
    }

    $steamRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:STEAMROOT) | Where-Object { $_ } | Select-Object -Unique
    $candidates = @()
    foreach ($steamRoot in $steamRoots) {
        foreach ($product in @('Counter-Strike 2', 'Counter-Strike Global Offensive')) {
            foreach ($relative in @('game\csgo\cfg', 'csgo\cfg')) {
                $candidate = Join-Path $steamRoot "Steam\steamapps\common\$product\$relative"
                if (Test-Path -LiteralPath $candidate -PathType Container) { $candidates += $candidate }
            }
        }
    }
    $candidates = $candidates | Select-Object -Unique
    if ($candidates.Count -eq 1) { return [string]$candidates[0] }
    if ($candidates.Count -eq 0) { throw '未找到 CS2 cfg 目录，请使用 -Cs2Root <path>' }
    throw "找到多个 CS2 cfg 目录，请使用 -Cs2Root <path> 指定目标（候选数: $($candidates.Count)）"
}

$cfgDirectory = Resolve-CfgDirectory -ExplicitRoot $Cs2Root
$cfgPath = Join-Path $cfgDirectory 'gamestate_integration_rivalhub_broadcast.cfg'
New-Item -ItemType Directory -Force -Path $script:QualificationStateRoot | Out-Null
$backupPath = Join-Path $script:QualificationStateRoot 'gamestate_integration_rivalhub_broadcast.cfg.original'
$hadExisting = Test-Path -LiteralPath $cfgPath -PathType Leaf
if ($hadExisting) { Copy-Item -LiteralPath $cfgPath -Destination $backupPath -Force }

$token = New-QualificationToken
$templatePath = Join-Path $script:BundleRoot 'config\gamestate_integration_rivalhub_broadcast.cfg.template'
$template = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
$materialized = $template.Replace('REPLACE_WITH_GSI_TOKEN', $token)
Write-Utf8NoBom -Path $cfgPath -Content $materialized

$cs2RootForVersion = Split-Path (Split-Path (Split-Path $cfgDirectory -Parent) -Parent) -Parent
$cs2ExecutableCandidates = @(
    (Join-Path $cs2RootForVersion 'game\bin\win64\cs2.exe'),
    (Join-Path (Split-Path $cfgDirectory -Parent) 'bin\win64\cs2.exe')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -Unique
$cs2Version = 'unknown'
if ($cs2ExecutableCandidates.Count -gt 0) {
    $cs2Version = (Get-Item -LiteralPath $cs2ExecutableCandidates[0]).VersionInfo.ProductVersion
}

$fingerprint = (Get-FileHash -LiteralPath $cfgPath -Algorithm SHA256).Hash.ToLowerInvariant()
$state = [ordered]@{
    schemaVersion = 1
    cfgPath = $cfgPath
    backupPath = $(if ($hadExisting) { $backupPath } else { $null })
    hadExistingConfig = $hadExisting
    gsiToken = $token
    cs2Version = $cs2Version
    cfgFingerprint = $fingerprint
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
}
Write-JsonFile -Path $script:InstallStatePath -Value $state

Write-Output "GSI config installed: $cfgPath"
Write-Output "Config fingerprint (SHA-256): $fingerprint"
Write-Output 'Token generated and stored only in the private qualification state.'
Write-Output 'Next: run start.ps1.'
