[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
  $root = Split-Path -Parent $PSScriptRoot
  & (Join-Path $PSScriptRoot 'Test-Environment.ps1')
  if ($LASTEXITCODE -ne 0) { exit 1 }
  $target = Join-Path $root 'Codex-TokenBar.exe'
  if (!(Test-Path -LiteralPath $target)) { $target = Join-Path $root 'outputs\Codex-TokenBar.exe' }
  [void](New-Item -ItemType Directory -Path (Join-Path $root 'outputs') -Force)
  & (Join-Path $PSScriptRoot 'Configure-Taskbar.ps1') -Mode Apply -GeneratedOnly -LauncherPath $target | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  foreach ($entry in @(@('关闭统计','--stop'), @('打开原版','--original'), @('环境检查','--check'))) {
    $link = $shell.CreateShortcut((Join-Path $root ('outputs\' + $entry[0] + '.lnk')))
    $link.TargetPath = $target
    $link.Arguments = $entry[1]
    $link.WorkingDirectory = $root
    $link.Save()
  }
  ''
  '快捷方式已生成在项目的 outputs 文件夹。'
  '请将其中的 Codex-TokenBar.lnk 固定到任务栏。'
  '以后从该入口启动。移动项目文件夹后，请重新创建快捷方式并固定。'
} catch {
  '快捷方式创建失败'
  $_.Exception.Message
  exit 1
}
