Set-StrictMode -Version Latest

function Get-JobHuntRuntimeSpec {
    param([Parameter(Mandatory=$true)][string]$Architecture)
    # 固定官方版本与发布摘要，下载地址不接受用户输入。
    $hashes = @{
        x64 = '7c93e9d92bf68c07182b471aa187e35ee6cd08ef0f24ab060dfff605fcc1c57c'
        arm64 = '380d375cf650c5a7f2ef3ce29ac6ea9a1c9d2ec8ea8e8391e1a34fd543886ab3'
    }
    if (-not $hashes.ContainsKey($Architecture)) { throw 'RUNTIME_ARCHITECTURE_UNSUPPORTED' }
    $version = '22.22.2'
    $name = 'node-v' + $version + '-win-' + $Architecture
    return [pscustomobject]@{ Version=$version; Name=$name; Sha256=$hashes[$Architecture]; Url=('https://nodejs.org/download/release/v' + $version + '/' + $name + '.zip') }
}

function Get-JobHuntArchitecture {
    $value = $env:PROCESSOR_ARCHITEW6432
    if (-not $value) { $value = $env:PROCESSOR_ARCHITECTURE }
    switch ($value) {
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        default { throw 'RUNTIME_ARCHITECTURE_UNSUPPORTED' }
    }
}

function Test-JobHuntNode {
    param([Parameter(Mandatory=$true)][string]$NodePath)
    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { return $null }
    $process = $null
    try {
        # 真正创建内存 SQLite 验证能力，而非仅检查版本；探测输出不含用户数据。
        $probe = 'const v=process.versions.node.split(".").map(Number);if(!((v[0]===22&&v[1]>=20)||v[0]>=24))process.exit(2);const{DatabaseSync}=await import("node:sqlite");const db=new DatabaseSync(":memory:");db.prepare("SELECT 1").get();db.close();console.log(JSON.stringify({version:process.version,sqlite:true,platform:process.platform,arch:process.arch}));'
        $start = New-Object System.Diagnostics.ProcessStartInfo
        $start.FileName = [IO.Path]::GetFullPath($NodePath)
        $start.Arguments = '--input-type=module -'
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardInput = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.EnvironmentVariables.Remove('NODE_OPTIONS')
        $start.EnvironmentVariables.Remove('NODE_PATH')
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $start
        [void]$process.Start()
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.WriteLine($probe)
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(8000)) { $process.Kill(); $process.WaitForExit(); return $null }
        if ($process.ExitCode -ne 0 -or $output.Result.Length -gt 4096) { return $null }
        $result = $output.Result | ConvertFrom-Json
        if ($result.sqlite -ne $true -or $result.platform -ne 'win32') { return $null }
        return [pscustomobject]@{ NodePath=[IO.Path]::GetFullPath($NodePath); Version=$result.version; Arch=$result.arch; Sqlite=$true }
    } catch { return $null }
    finally { if ($null -ne $process) { $process.Dispose() } }
}

function Assert-JobHuntRuntimeDirectory {
    param([Parameter(Mandatory=$true)][string]$Directory, [Parameter(Mandatory=$true)][string]$PackageRoot)
    $directoryPath = [IO.Path]::GetFullPath($Directory).TrimEnd([char[]]'\/')
    $packagePath = [IO.Path]::GetFullPath($PackageRoot).TrimEnd([char[]]'\/')
    if ($directoryPath.Equals($packagePath, [StringComparison]::OrdinalIgnoreCase) -or $directoryPath.StartsWith($packagePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'RUNTIME_DIRECTORY_MUST_BE_OUTSIDE_PACKAGE' }
    # 拒绝缓存祖先上的重解析点，避免目录联接把下载内容导回代码目录。
    $ancestor = $directoryPath
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'RUNTIME_DIRECTORY_LINK_REJECTED' }
        }
        $parent = Split-Path -Parent $ancestor
        if ($parent -eq $ancestor) { break }
        $ancestor = $parent
    }
    return $directoryPath
}

function Find-JobHuntNode {
    param([string]$WorkBuddyRoot, [string[]]$SystemNodes=@(), [string]$CacheRoot)
    $candidates = @()
    if ($WorkBuddyRoot) {
        $versions = Join-Path $WorkBuddyRoot 'binaries/node/versions'
        $directories = @(Get-ChildItem -LiteralPath $versions -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 20)
        foreach ($directory in $directories) { $candidates += [pscustomobject]@{ Path=(Join-Path $directory.FullName 'node.exe'); Source='workbuddy' } }
    }
    foreach ($node in $SystemNodes) { if ($node) { $candidates += [pscustomobject]@{ Path=$node; Source='system' } } }
    if ($CacheRoot) {
        foreach ($arch in @('x64','arm64')) {
            $spec = Get-JobHuntRuntimeSpec $arch
            $candidates += [pscustomobject]@{ Path=(Join-Path (Join-Path $CacheRoot $spec.Name) 'node.exe'); Source='managed' }
        }
    }
    foreach ($candidate in $candidates) {
        $result = Test-JobHuntNode $candidate.Path
        if ($null -ne $result) { $result | Add-Member -NotePropertyName Source -NotePropertyValue $candidate.Source; return $result }
    }
    return $null
}

function Get-JobHuntFileHash {
    param([Parameter(Mandatory=$true)][string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Expand-JobHuntRuntimeArchive {
    param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination, [Parameter(Mandatory=$true)]$Spec)
    $actual = Get-JobHuntFileHash $Archive
    if ($actual -ne $Spec.Sha256) { throw 'RUNTIME_CHECKSUM_MISMATCH' }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        # 只取 node.exe 和许可证，不展开 npm/node_modules，也不使用 ZIP 内路径写盘。
        foreach ($name in @('node.exe','LICENSE')) {
            $entries = @($zip.Entries | Where-Object { $_.FullName -ceq ($Spec.Name + '/' + $name) })
            if ($entries.Count -ne 1 -or $entries[0].Length -le 0 -or $entries[0].Length -gt 209715200) { throw 'RUNTIME_ARCHIVE_INVALID' }
            $target = Join-Path $Destination $name
            $source = $entries[0].Open()
            $file = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $source.CopyTo($file) } finally { $file.Dispose(); $source.Dispose() }
        }
    } finally { $zip.Dispose() }
}

function Receive-JobHuntRuntimeDownload {
    param([Parameter(Mandatory=$true)][string]$Url, [Parameter(Mandatory=$true)][string]$Destination)
    # 下载使用系统 .NET，关闭跳转并限制体积，不依赖 npm 或额外 PowerShell 模块。
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(120)
    $deadline = New-Object Threading.CancellationTokenSource
    $deadline.CancelAfter(120000)
    $response = $null; $inputStream = $null; $outputStream = $null
    try {
        $response = $client.GetAsync($Url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 200 -or $response.Content.Headers.ContentLength -gt 104857600) { throw 'RUNTIME_DOWNLOAD_FAILED' }
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $buffer = New-Object byte[] 65536
        $total = 0
        while (($count = $inputStream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token).GetAwaiter().GetResult()) -gt 0) {
            $total += $count
            if ($total -gt 104857600) { throw 'RUNTIME_ARCHIVE_TOO_LARGE' }
            $outputStream.Write($buffer, 0, $count)
        }
    } catch { throw 'RUNTIME_DOWNLOAD_FAILED' }
    finally {
        if ($null -ne $outputStream) { $outputStream.Dispose() }
        if ($null -ne $inputStream) { $inputStream.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
        $deadline.Dispose(); $client.Dispose(); $handler.Dispose()
    }
}

function Install-JobHuntNode {
    param([Parameter(Mandatory=$true)][string]$PackageRoot, [Parameter(Mandatory=$true)][string]$CacheRoot, [Parameter(Mandatory=$true)][string]$Architecture)
    $CacheRoot = Assert-JobHuntRuntimeDirectory $CacheRoot $PackageRoot
    $spec = Get-JobHuntRuntimeSpec $Architecture
    [void][IO.Directory]::CreateDirectory($CacheRoot)
    $lock = $null; $stage = $null
    try {
        # 共享锁随进程结束释放，避免并发安装或永久遗留占用。
        try { $lock = [IO.File]::Open((Join-Path $CacheRoot 'install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) } catch { throw 'RUNTIME_INSTALL_BUSY' }
        $destination = Join-Path $CacheRoot $spec.Name
        if (Test-Path -LiteralPath $destination) {
            $existing = Test-JobHuntNode (Join-Path $destination 'node.exe')
            if ($null -eq $existing -or $existing.Version -ne ('v' + $spec.Version) -or $existing.Arch -ne $Architecture) { throw 'RUNTIME_CACHE_INVALID' }
            $existing | Add-Member -NotePropertyName Source -NotePropertyValue 'managed'
            return $existing
        }
        $stage = Join-Path $CacheRoot ('.install-' + [Guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($stage)
        $archive = Join-Path $stage 'runtime.zip'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Receive-JobHuntRuntimeDownload $spec.Url $archive
        if ((Get-Item -LiteralPath $archive).Length -gt 104857600) { throw 'RUNTIME_ARCHIVE_TOO_LARGE' }
        $payload = Join-Path $stage 'payload'
        [void][IO.Directory]::CreateDirectory($payload)
        Expand-JobHuntRuntimeArchive $archive $payload $spec
        $result = Test-JobHuntNode (Join-Path $payload 'node.exe')
        if ($null -eq $result -or $result.Version -ne ('v' + $spec.Version) -or $result.Arch -ne $Architecture) { throw 'RUNTIME_VERIFICATION_FAILED' }
        Move-Item -LiteralPath $payload -Destination $destination -ErrorAction Stop
        $result.NodePath = Join-Path $destination 'node.exe'
        $result | Add-Member -NotePropertyName Source -NotePropertyValue 'managed'
        return $result
    } finally {
        if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
        if ($null -ne $lock) { $lock.Dispose() }
    }
}

function Resolve-JobHuntNode {
    param([Parameter(Mandatory=$true)][string]$PackageRoot, [Parameter(Mandatory=$true)][string]$CacheRoot, [string]$WorkBuddyRoot, [string[]]$SystemNodes=@(), [switch]$NoDownload)
    $CacheRoot = Assert-JobHuntRuntimeDirectory $CacheRoot $PackageRoot
    $result = Find-JobHuntNode -WorkBuddyRoot $WorkBuddyRoot -SystemNodes $SystemNodes -CacheRoot $CacheRoot
    if ($null -ne $result) { return $result }
    if ($NoDownload) { throw 'RUNTIME_NOT_FOUND_DOWNLOAD_DISABLED' }
    return Install-JobHuntNode -PackageRoot $PackageRoot -CacheRoot $CacheRoot -Architecture (Get-JobHuntArchitecture)
}

Export-ModuleMember -Function Get-JobHuntFileHash, Get-JobHuntRuntimeSpec, Test-JobHuntNode, Assert-JobHuntRuntimeDirectory, Find-JobHuntNode, Expand-JobHuntRuntimeArchive, Install-JobHuntNode, Resolve-JobHuntNode
