[CmdletBinding()]
param([switch]$SkipTests, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -Force
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Archive') -Force
$root = Split-Path -Parent $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $root 'outputs' }
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$') { throw 'Invalid release version.' }
$node = & (Join-Path $PSScriptRoot 'Resolve-Node.ps1')
Push-Location $root
try {
  if (!$SkipTests) {
    if (!(Test-Path (Join-Path $root 'node_modules\jsdom'))) {
      & npm.cmd ci --ignore-scripts --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw 'Development dependency installation failed.' }
    }
    & $node --test tests/*.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed. Release packaging stopped.' }
  }
  $build = Join-Path $root ('work\release-' + [guid]::NewGuid().ToString('N'))
  $stage = Join-Path $build 'Codex-TokenBar'
  [void](New-Item -ItemType Directory -Path $stage -Force)
  $compiled = Join-Path $build 'compiled'
  & (Join-Path $PSScriptRoot 'Build-TokenBar.ps1') -LauncherOnly -OutputDirectory $compiled | Out-Null
  foreach ($name in @('Codex-TokenBar', '环境检查', '创建快捷方式', '关闭统计', '打开原版')) {
    Copy-Item -LiteralPath (Join-Path $compiled 'Codex-TokenBar.exe') -Destination (Join-Path $stage ($name + '.exe'))
  }
  $files = @('README.md','LICENSE','package.json',
    'src\cdp.mjs','src\json-project.mjs','src\rollout-reader.mjs','src\usage-state.mjs','src\usage-view.mjs','src\static-bar.mjs','src\TaskbarIdentity.cs',
    'scripts\Start-TokenBar.ps1','scripts\Open-Codex.ps1','scripts\Stop-TokenBar.ps1','scripts\TokenBar-Probe.ps1',
    'scripts\probe.mjs','scripts\run-tokenbar.mjs','scripts\Configure-Taskbar.ps1','scripts\Resolve-Node.ps1','scripts\Test-Environment.ps1','scripts\Setup-TokenBar.ps1')
  foreach ($file in $files) {
    $destination = Join-Path $stage $file
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $destination
  }
  Copy-Item -LiteralPath (Join-Path $root 'docs') -Destination $stage -Recurse
  [IO.File]::WriteAllText((Join-Path $stage '使用说明.txt'), "安装 Microsoft Store 版 Codex 和 Node.js 22+（推荐 LTS）。`r`n正常退出已打开的 Codex，再双击 Codex-TokenBar.exe。`r`n需要任务栏入口时，运行创建快捷方式.exe，固定 outputs 中的 Codex-TokenBar.lnk。`r`n停止用关闭统计.exe；恢复官方入口用打开原版.exe。`r`n启动遇到问题时，运行环境检查.exe。`r`n请完整解压，并保留整个文件夹。`r`n", [Text.UTF8Encoding]::new($true))
  [void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
  $name = 'Codex-TokenBar-' + $version + '-win-x64.zip'
  $archive = Join-Path $OutputDirectory $name
  if (Test-Path -LiteralPath $archive) { throw 'Release archive already exists. Use another -OutputDirectory or increment the version.' }
  Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal
  $checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $name
  [IO.File]::WriteAllText(($archive + '.sha256'), $checksum + "`n")
  Get-Item -LiteralPath $archive | Select-Object Name,Length
  $checksum
} finally { Pop-Location }
