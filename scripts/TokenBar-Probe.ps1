[CmdletBinding()]
param(
  [ValidateSet('Inspect','Mount','Stop')][string]$Mode = 'Inspect',
  [ValidateRange(1024,65535)][int]$Port = 9337,
  [string]$AnchorSelector,
  [switch]$Launch,
  [switch]$CheckOnly,
  [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
$package = @(Get-AppxPackage -Name OpenAI.Codex)
if ($package.Count -ne 1) { throw 'Codex Store package is not unique. No changes made.' }
$package = $package[0]
$manifest = [xml](Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw)
$application = @($manifest.Package.Applications.Application | Where-Object { $_.Executable -match '(^|[/\\])ChatGPT\.exe$' })
if ($application.Count -ne 1) { throw 'Codex application entry is not unique.' }
$desktopPath = [IO.Path]::GetFullPath((Join-Path $package.InstallLocation $application[0].Executable))
$nodePath = (& (Join-Path $PSScriptRoot 'Resolve-Node.ps1'))
$nodeMajor = [int]((& $nodePath --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Node.js 22 or newer is required.' }
if ($Mode -eq 'Mount' -and [string]::IsNullOrWhiteSpace($AnchorSelector)) { throw 'Inspect the live DOM first; then explicitly supply -AnchorSelector.' }

function Get-TokenBarListeners {
  # netstat avoids the WMI provider while retaining endpoint ownership checks.
  $rows = & (Join-Path $env:WINDIR 'System32\netstat.exe') -ano -p TCP
  if ($LASTEXITCODE -ne 0) { throw 'TCP listener enumeration failed.' }
  foreach ($row in $rows) {
    $fields = $row.Trim() -split '\s+'
    if ($fields.Count -eq 5 -and $fields[0] -eq 'TCP' -and $fields[3] -eq 'LISTENING' -and $fields[1] -match (':'+$Port+'$')) {
      $address = $fields[1].Substring(0, $fields[1].LastIndexOf(':')).Trim('[',']')
      [pscustomobject]@{ LocalAddress=$address; OwningProcess=[int]$fields[4] }
    }
  }
}
function Assert-TokenBarListener($Listeners) {
  if (!$Listeners.Count) { throw 'CDP port is not open.' }
  foreach ($listener in $Listeners) {
    if ($listener.LocalAddress -ne '127.0.0.1') { throw 'CDP must bind exclusively to 127.0.0.1. No connection made.' }
    $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if (!$owner -or ![string]::Equals($owner.Path, $desktopPath, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'CDP listener is not owned by the verified Codex executable.'
    }
  }
}

$listeners = @(Get-TokenBarListeners)
if ($VerifyOnly) {
  if ($listeners.Count) { Assert-TokenBarListener $listeners }
  $running = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {
    [string]::Equals($_.Path, $desktopPath, [StringComparison]::OrdinalIgnoreCase)
  })
  [pscustomobject]@{ cdpAvailable=($listeners.Count -gt 0); officialRunning=($running.Count -gt 0) } | ConvertTo-Json
  return
}
if ($CheckOnly) {
  if ($listeners.Count) { Assert-TokenBarListener $listeners }
  [pscustomobject]@{ packageVersion=[string]$package.Version; nodeMajor=$nodeMajor; cdpAvailable=($listeners.Count -gt 0); action='check-only-no-launch' } | ConvertTo-Json
  return
}
if (!$listeners.Count) {
  if (!$Launch) { throw 'Codex has no CDP endpoint. Exit Codex normally, then run this script with -Launch. This script never closes Codex.' }
  if ($Mode -ne 'Inspect') { throw 'First launch is inspection only. Run Mount separately after reviewing the live report.' }
  $running = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {
    [string]::Equals($_.Path, $desktopPath, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($running.Count) { throw 'Codex is still running. Exit normally after saving work; no process was terminated.' }
  if (!('TokenBarProbe.Activation' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace TokenBarProbe {
  [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IApplicationActivationManager {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string args, int options, out uint processId);
  }
  [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] class ApplicationActivationManager {}
  public static class Activation {
    public static uint Launch(string id, string args) {
      var manager = (IApplicationActivationManager)new ApplicationActivationManager();
      uint processId;
      Marshal.ThrowExceptionForHR(manager.ActivateApplication(id, args, 2, out processId));
      return processId;
    }
  }
}
'@
  }
  $appId = "$($package.PackageFamilyName)!$($application[0].Id)"
  [void][TokenBarProbe.Activation]::Launch($appId, "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$Port")
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 500
    $listeners = @(Get-TokenBarListeners)
  } while (!$listeners.Count -and [DateTime]::UtcNow -lt $deadline)
}
Assert-TokenBarListener $listeners
$probePath = Join-Path $PSScriptRoot 'probe.mjs'
& $nodePath $probePath $Mode $Port $AnchorSelector
if ($LASTEXITCODE -ne 0) { throw "Probe failed with exit code $LASTEXITCODE. No application files were changed." }
