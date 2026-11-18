[CmdletBinding()]
param([switch]$LauncherOnly, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -Force
$root = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler is unavailable.' }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $root 'outputs' }
if (!$LauncherOnly -and [IO.Path]::GetFullPath($OutputDirectory) -ne (Join-Path $root 'outputs')) { throw 'Custom output directories require -LauncherOnly.' }
$target = Join-Path $OutputDirectory 'Codex-TokenBar.exe'
[void](New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force)
$compilerArgs = @('/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll', "/out:$target")
$package = @(Get-AppxPackage -Name OpenAI.Codex)
$icon = $null
if ($package.Count -eq 1) {
  $icon = Join-Path $package[0].InstallLocation 'app\resources\chatgpt-app-dark.ico'
}
if (!$icon -or !(Test-Path -LiteralPath $icon)) {
  Add-Type -AssemblyName System.Drawing
  $icon = Join-Path $OutputDirectory 'launcher-build.ico'
  $stream = [IO.File]::Create($icon)
  try { [Drawing.SystemIcons]::Application.Save($stream) } finally { $stream.Dispose() }
}
$compilerArgs += "/win32icon:$icon"
& $compiler @compilerArgs (Join-Path $root 'src\TokenBarLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
if ($LauncherOnly) { Get-FileHash -LiteralPath $target -Algorithm SHA256 | Select-Object Path,Hash; return }
$shortcuts = New-Object -ComObject WScript.Shell
foreach ($entry in @(@('关闭 TokenBar','--stop'), @('打开原版 Codex','--original'))) {
  $link = $shortcuts.CreateShortcut((Join-Path $root ('outputs\' + $entry[0] + '.lnk')))
  $link.TargetPath = $target
  $link.Arguments = $entry[1]
  $link.WorkingDirectory = $root
  $link.Save()
}
& (Join-Path $PSScriptRoot 'Configure-Taskbar.ps1') -Mode Apply -GeneratedOnly
Get-FileHash -LiteralPath $target -Algorithm SHA256 | Select-Object Path,Hash
