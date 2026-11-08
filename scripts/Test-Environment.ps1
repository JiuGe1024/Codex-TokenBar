[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
  $root = Split-Path -Parent $PSScriptRoot
  if (![Environment]::Is64BitOperatingSystem) { throw '需要 64 位 Windows。' }
  $node = & (Join-Path $PSScriptRoot 'Resolve-Node.ps1')
  $packages = @(Get-AppxPackage -Name OpenAI.Codex)
  if ($packages.Count -eq 0) { throw '请先通过 Microsoft Store 安装并登录 Codex。' }
  $inspection = (& (Join-Path $PSScriptRoot 'TokenBar-Probe.ps1') -CheckOnly | ConvertFrom-Json)
  [void](New-Item -ItemType Directory -Path (Join-Path $root 'work') -Force)
  '环境检查通过'
  'Node.js ' + (& $node --version)
  'Codex ' + $inspection.packageVersion
  '项目工作目录可写。'
  if ($inspection.cdpAvailable) { '当前 Codex 已开启合规的本机调试监听，可以连接统计。' }
  else { '首次使用时，请正常退出 Codex，再双击 Codex-TokenBar.exe 打开。' }
} catch {
  '环境检查未通过'
  $_.Exception.Message
  exit 1
}
