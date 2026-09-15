param([string]$Cs2Root)
. (Join-Path $PSScriptRoot 'common.ps1')

function Get-SteamInstallRoots {
    $roots = @()
    foreach ($baseRoot in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:STEAMROOT)) {
        if (-not $baseRoot) { continue }
        $roots += [string]$baseRoot
        $roots += Join-Path ([string]$baseRoot) 'Steam'
    }
    foreach ($registryPath in @(
        'HKCU:\Software\Valve\Steam',
        'HKLM:\SOFTWARE\Valve\Steam',
        'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam'
    )) {
        try {
            $properties = Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop
            foreach ($propertyName in @('InstallPath', 'SteamPath')) {
                $value = $properties.$propertyName
                if ($value) { $roots += [string]$value }
            }
        } catch { }
    }
    return @($roots | Where-Object { $_ } | ForEach-Object { [string]$_ } | Select-Object -Unique)
}

function Convert-VdfPath {
    param([Parameter(Mandatory = $true)][string]$Value)
    return $Value.Replace('\\', '\').Replace('\"', '"')
}

function Get-SteamLibraryRoots {
    param([Parameter(Mandatory = $true)][string]$SteamRoot)
    $libraries = @($SteamRoot)
    $metadataPath = Join-Path $SteamRoot 'steamapps\libraryfolders.vdf'
    if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
        try {
            $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8
            foreach ($pattern in @(
                '(?im)^\s*"path"\s+"(?<path>(?:\\.|[^"])*)"',
                '(?im)^\s*"\d+"\s+"(?<path>(?:\\.|[^"])*)"'
            )) {
                foreach ($match in [regex]::Matches($metadata, $pattern)) {
                    $path = Convert-VdfPath -Value $match.Groups['path'].Value
                    if ($path -and (Test-Path -LiteralPath $path -PathType Container)) { $libraries += $path }
                }
            }
        } catch { }
    }
    return @($libraries | Where-Object { $_ } | Select-Object -Unique)
}

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
        )
        $candidates = @($candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -Unique)
        if ($candidates.Count -eq 1) { return [string]$candidates[0] }
        throw "无法从 -Cs2Root 解析唯一的 CS2 cfg 目录；请传入 game\csgo\cfg 或 CS2 安装根目录"
    }

    $steamRoots = @(Get-SteamInstallRoots)
    $libraryRoots = @()
    foreach ($steamRoot in $steamRoots) { $libraryRoots += @(Get-SteamLibraryRoots -SteamRoot $steamRoot) }
    $libraryRoots = @($libraryRoots | Where-Object { $_ } | Select-Object -Unique)
    $candidates = @()
    foreach ($libraryRoot in $libraryRoots) {
        foreach ($product in @('Counter-Strike 2', 'Counter-Strike Global Offensive')) {
            foreach ($relative in @('game\csgo\cfg', 'csgo\cfg')) {
                $candidate = Join-Path $libraryRoot "steamapps\common\$product\$relative"
                if (Test-Path -LiteralPath $candidate -PathType Container) { $candidates += $candidate }
            }
        }
    }
    $candidates = @($candidates | Select-Object -Unique)
    if ($candidates.Count -eq 1) { return [string]$candidates[0] }
    if ($candidates.Count -eq 0) { throw '未找到 CS2 cfg 目录；请传入 -Cs2Root <path>' }
    throw "找到多个 CS2 cfg 目录；请传入 -Cs2Root <path> 选择一个（候选数：$($candidates.Count)）"
}

$cfgDirectory = Resolve-CfgDirectory -ExplicitRoot $Cs2Root
$cfgPath = Join-Path $cfgDirectory 'gamestate_integration_rivalhub_broadcast.cfg'
Write-GsiEndpointConflictWarning -CfgDirectory $cfgDirectory -CanonicalCfgPath $cfgPath | Out-Null
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
)
$cs2ExecutableCandidates = @($cs2ExecutableCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -Unique)
$cs2Version = 'unknown'
if ($cs2ExecutableCandidates.Count -gt 0) {
    $reportedVersion = [string](Get-Item -LiteralPath $cs2ExecutableCandidates[0]).VersionInfo.ProductVersion
    if (-not [string]::IsNullOrWhiteSpace($reportedVersion)) { $cs2Version = $reportedVersion.Trim() }
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

Write-Output "GSI 配置已安装：$cfgPath"
Write-Output "配置指纹（SHA-256）：$fingerprint"
Write-Output 'Token 已生成，仅保存在本地 qualification 状态中。'
Write-Output '下一步：执行 start.ps1。'
