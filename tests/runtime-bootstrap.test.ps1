param([Parameter(Mandatory=$true)][string]$NodePath, [Parameter(Mandatory=$true)][string]$TemporaryRoot)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $root 'scripts/runtime-bootstrap.psm1') -Force -DisableNameChecking
$results = @()
function Check([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Rejects([scriptblock]$Operation, [string]$Code) {
    $caught = $null
    try { & $Operation | Out-Null } catch { $caught = $_.Exception.Message }
    Check ($caught -eq $Code) ('Expected ' + $Code + ', got ' + $caught)
}
try {
    $base = Test-JobHuntNode $NodePath
    Check ($null -ne $base -and $base.Sqlite) 'ACTUAL_NODE_PROBE_FAILED'
    $results += 'actual-node-and-sqlite-probe'
    $workBuddy = Join-Path $TemporaryRoot '模拟 WorkBuddy'
    $version = Join-Path $workBuddy 'binaries/node/versions/22.22.2-test'
    [void][IO.Directory]::CreateDirectory($version)
    $copy = Join-Path $version 'node.exe'
    Copy-Item -LiteralPath $NodePath -Destination $copy
    $cache = Join-Path $TemporaryRoot '缓存'
    $node = Resolve-JobHuntNode -PackageRoot $root -CacheRoot $cache -WorkBuddyRoot $workBuddy -SystemNodes @($NodePath) -NoDownload
    Check ($node.Source -eq 'workbuddy' -and $node.NodePath -eq $copy) 'WORKBUDDY_PRIORITY_FAILED'
    Check (-not (Test-Path -LiteralPath $cache)) 'REUSED_RUNTIME_CREATED_CACHE'
    $results += 'workbuddy-first-no-download-or-cache-write'
    $node = Resolve-JobHuntNode -PackageRoot $root -CacheRoot $cache -WorkBuddyRoot (Join-Path $TemporaryRoot 'missing') -SystemNodes @($NodePath) -NoDownload
    Check ($node.Source -eq 'system') 'SYSTEM_FALLBACK_FAILED'
    $results += 'system-runtime-fallback'
    Rejects { Resolve-JobHuntNode -PackageRoot $root -CacheRoot $cache -WorkBuddyRoot (Join-Path $TemporaryRoot 'missing') -SystemNodes @() -NoDownload } 'RUNTIME_NOT_FOUND_DOWNLOAD_DISABLED'
    Rejects { Assert-JobHuntRuntimeDirectory (Join-Path $root 'runtime/example') $root } 'RUNTIME_DIRECTORY_MUST_BE_OUTSIDE_PACKAGE'
    $results += 'offline-missing-and-package-directory-rejected'
    $spec = Get-JobHuntRuntimeSpec $base.Arch
    $managed = Join-Path $cache $spec.Name
    [void][IO.Directory]::CreateDirectory($managed)
    Move-Item -LiteralPath $copy -Destination (Join-Path $managed 'node.exe')
    $node = Resolve-JobHuntNode -PackageRoot $root -CacheRoot $cache -WorkBuddyRoot (Join-Path $TemporaryRoot 'missing') -NoDownload
    Check ($node.Source -eq 'managed') 'MANAGED_CACHE_FALLBACK_FAILED'
    $results += 'managed-runtime-cache-reuse'
    # 合成 ZIP 不含真实业务数据，额外路径用于验证不会发生目录穿越。
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipFile = Join-Path $TemporaryRoot 'fixture.zip'
    $zip = [IO.Compression.ZipFile]::Open($zipFile, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in @('node.exe','LICENSE','../../escape.txt','node_modules/ignored.txt')) {
            $entry = $zip.CreateEntry('fixture/' + $name)
            $writer = New-Object IO.StreamWriter($entry.Open())
            try { $writer.Write('fictional fixture') } finally { $writer.Dispose() }
        }
    } finally { $zip.Dispose() }
    $out = Join-Path $TemporaryRoot 'extracted'
    [void][IO.Directory]::CreateDirectory($out)
    $fixtureSpec = [pscustomobject]@{ Name='fixture'; Sha256=(Get-JobHuntFileHash $zipFile) }
    Expand-JobHuntRuntimeArchive $zipFile $out $fixtureSpec
    Check ((@(Get-ChildItem -LiteralPath $out -File)).Count -eq 2) 'EXTRACTION_ALLOWLIST_FAILED'
    Check (-not (Test-Path -LiteralPath (Join-Path $TemporaryRoot 'escape.txt'))) 'ZIP_PATH_TRAVERSAL'
    $results += 'verified-archive-minimal-extraction'
    $badOut = Join-Path $TemporaryRoot 'rejected'
    [void][IO.Directory]::CreateDirectory($badOut)
    $fixtureSpec.Sha256 = 'invalid'
    Rejects { Expand-JobHuntRuntimeArchive $zipFile $badOut $fixtureSpec } 'RUNTIME_CHECKSUM_MISMATCH'
    Check ((@(Get-ChildItem -LiteralPath $badOut)).Count -eq 0) 'EXTRACTED_BEFORE_HASH_CHECK'
    $results += 'checksum-failure-before-extraction'
    # 在模块作用域模拟断网，验证安装失败的临时文件和锁均被清理释放。
    $module = Get-Module 'runtime-bootstrap'
    & $module { function script:Receive-JobHuntRuntimeDownload { throw 'RUNTIME_DOWNLOAD_FAILED' } }
    $installCache = Join-Path $TemporaryRoot 'failed-install'
    Rejects { Install-JobHuntNode -PackageRoot $root -CacheRoot $installCache -Architecture $base.Arch } 'RUNTIME_DOWNLOAD_FAILED'
    Check ((@(Get-ChildItem -LiteralPath $installCache -Force | Where-Object Name -Like '.install-*')).Count -eq 0) 'INSTALL_STAGING_LEAKED'
    $lockPath = Join-Path $installCache 'install.lock'
    $lock = [IO.File]::Open($lockPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try { Rejects { Install-JobHuntNode -PackageRoot $root -CacheRoot $installCache -Architecture $base.Arch } 'RUNTIME_INSTALL_BUSY' } finally { $lock.Dispose() }
    $results += 'download-failure-cleanup-and-install-lock'
    [pscustomobject]@{ ok=$true; checks=$results; siteRequestPerformed=$false; officialDownloadPerformed=$false } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
