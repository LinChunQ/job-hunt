# Windows 原生入口无需 Node 启动；内部命令原样交给已验证运行时。
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$exitCode = 2
try {
    $packageRoot = Split-Path -Parent $PSScriptRoot
    Import-Module (Join-Path $PSScriptRoot 'runtime-bootstrap.psm1') -Force -DisableNameChecking
    $commandArgs = @($args)
    $noDownload = $false
    $runtimeInfo = $false
    while ($commandArgs.Count -gt 0) {
        if ($commandArgs[0] -eq '--no-runtime-download') { $noDownload = $true }
        elseif ($commandArgs[0] -eq '--runtime-info') { $runtimeInfo = $true }
        else { break }
        $commandArgs = @($commandArgs | Select-Object -Skip 1)
    }
    $homePath = [Environment]::GetFolderPath('UserProfile')
    $workBuddyRoot = $env:JOB_HUNT_WORKBUDDY_DIR
    if (-not $workBuddyRoot) { $workBuddyRoot = Join-Path $homePath '.workbuddy-ai' }
    $cacheRoot = $env:JOB_HUNT_RUNTIME_DIR
    if (-not $cacheRoot) { $cacheRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'job-hunt/runtime' }
    $systemNodes = @(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    $selected = Resolve-JobHuntNode -PackageRoot $packageRoot -CacheRoot $cacheRoot -WorkBuddyRoot $workBuddyRoot -SystemNodes $systemNodes -NoDownload:$noDownload
    if ($runtimeInfo) {
        [pscustomobject]@{ ok=$true; nodePath=$selected.NodePath; nodeVersion=$selected.Version; source=$selected.Source; sqlite=$true; systemPathChanged=$false } | ConvertTo-Json -Compress
        $exitCode = 0
    } else {
        if ($commandArgs.Count -eq 0) { $commandArgs = @('doctor') }
        # 不拼接命令字符串；路径含空格与中文时仍作为独立参数传递。
        $savedOptions = $env:NODE_OPTIONS; $savedPath = $env:NODE_PATH
        try {
            $env:NODE_OPTIONS = $null; $env:NODE_PATH = $null
            & $selected.NodePath (Join-Path $PSScriptRoot 'job-hunt.mjs') @commandArgs
            $exitCode = $LASTEXITCODE
        } finally { $env:NODE_OPTIONS = $savedOptions; $env:NODE_PATH = $savedPath }
    }
} catch {
    $code = 'RUNTIME_BOOTSTRAP_FAILED'
    if ($_.Exception.Message -cmatch '^[A-Z][A-Z0-9_]{0,79}$') { $code = $_.Exception.Message }
    [pscustomobject]@{ ok=$false; errorCode=$code } | ConvertTo-Json -Compress
}
exit $exitCode
