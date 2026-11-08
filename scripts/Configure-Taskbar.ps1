[CmdletBinding()]
param([ValidateSet('Inspect','Apply','Restore')][string]$Mode = 'Inspect', [switch]$GeneratedOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (!('TokenBar.TaskbarIdentity' -as [type])) { Add-Type -Path (Join-Path $root 'src\TaskbarIdentity.cs') }
$target = Join-Path $root 'outputs\Codex-TokenBar.exe'
$pinDirectory = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$pinnedPath = Join-Path $pinDirectory 'Codex-TokenBar.lnk'
$backup = Join-Path $root 'work\taskbar-identity-original.json'
$wscript = New-Object -ComObject WScript.Shell
function Read-OwnShortcut([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { return $null }
  $link = $wscript.CreateShortcut($Path)
  if (![string]::Equals($link.TargetPath, $target, [StringComparison]::OrdinalIgnoreCase) -or $link.Arguments -ne '') {
    throw 'Shortcut target or arguments do not match TokenBar. No changes made.'
  }
  [pscustomobject]@{path=$Path;target=$link.TargetPath;arguments=$link.Arguments;id=[TokenBar.TaskbarIdentity]::ReadShortcut($Path)}
}
$before = if (!$GeneratedOnly) { Read-OwnShortcut $pinnedPath } else { $null }
if ($Mode -eq 'Restore') {
  if (!$before -or !(Test-Path -LiteralPath $backup)) { throw 'Original shortcut identity is unavailable.' }
  $original = Get-Content -LiteralPath $backup -Raw | ConvertFrom-Json
  if ($original.path -ne $pinnedPath -or $original.target -ne $target -or $original.arguments -ne '') { throw 'Restore record does not match the verified shortcut.' }
  [TokenBar.TaskbarIdentity]::SetShortcut($pinnedPath, $original.id)
  Read-OwnShortcut $pinnedPath | ConvertTo-Json
  return
}
$packages = @(Get-AppxPackage -Name OpenAI.Codex)
if ($packages.Count -ne 1) { throw 'Codex package is not unique.' }
$package = $packages[0]
$manifest = [xml](Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw)
$apps = @($manifest.Package.Applications.Application | Where-Object { $_.Executable -match '(^|[/\\])ChatGPT\.exe$' })
if ($apps.Count -ne 1) { throw 'Codex application entry is not unique.' }
$appId = "$($package.PackageFamilyName)!$($apps[0].Id)"
$desktopPath = [IO.Path]::GetFullPath((Join-Path $package.InstallLocation $apps[0].Executable))
$windows = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {
  [string]::Equals($_.Path, $desktopPath, [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Get-Process -Id $_.Id -ErrorAction Stop } | Where-Object MainWindowHandle -ne 0)
$windowId = $null
if ($windows.Count -gt 1) { throw 'Multiple Codex windows: inspect grouping before applying.' }
if ($windows.Count -eq 1) {
  $windowId = [TokenBar.TaskbarIdentity]::ReadWindow([long]$windows[0].MainWindowHandle)
  if (($windowId -and $windowId -ne $appId) -or [TokenBar.TaskbarIdentity]::ReadPackagedProcess($windows[0].Id) -ne $appId) {
    throw 'Window identity differs from the registered Codex identity. No changes made.'
  }
}
$outputLink = Join-Path $root 'outputs\Codex-TokenBar.lnk'
if ($Mode -eq 'Apply') {
  if (!(Test-Path -LiteralPath $target)) { throw 'Build the TokenBar launcher first.' }
  if ($before -and $before.id -and $before.id -ne $appId) { throw 'Pinned shortcut already has another identity. No changes made.' }
  [void](New-Item -ItemType Directory -Path (Join-Path $root 'work') -Force)
  if ($before -and !(Test-Path -LiteralPath $backup)) { $before | ConvertTo-Json | Set-Content -LiteralPath $backup -Encoding utf8 }
  $link = $wscript.CreateShortcut($outputLink)
  $link.TargetPath = $target; $link.WorkingDirectory = $root; $link.Arguments = ''; $link.IconLocation = "$target,0"
  $link.Save()
  [TokenBar.TaskbarIdentity]::SetShortcut($outputLink, $appId)
  if ($before) { [TokenBar.TaskbarIdentity]::SetShortcut($pinnedPath, $appId) }
}
$after = if (!$GeneratedOnly) { Read-OwnShortcut $pinnedPath } else { $null }
$result = [pscustomobject]@{mode=$Mode;appId=$appId;windowOverride=$windowId;before=$before;after=$after;generatedShortcut=(Read-OwnShortcut $outputLink)}
if ($Mode -eq 'Apply' -and !$GeneratedOnly) { $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'outputs\taskbar-identity-live.json') -Encoding utf8 }
$result | ConvertTo-Json -Depth 5
