[CmdletBinding()]
param([switch]$OriginalOnly)
$ErrorActionPreference = 'Stop'
$packages = @(Get-AppxPackage -Name OpenAI.Codex)
if ($packages.Count -ne 1) { throw 'Codex Store package is not unique.' }
$package = $packages[0]
$manifest = [xml](Get-Content -LiteralPath (Join-Path $package.InstallLocation 'AppxManifest.xml') -Raw)
$apps = @($manifest.Package.Applications.Application | Where-Object { $_.Executable -match '(^|[/\\])ChatGPT\.exe$' })
if ($apps.Count -ne 1) { throw 'Codex application entry is not unique.' }
$desktopPath = [IO.Path]::GetFullPath((Join-Path $package.InstallLocation $apps[0].Executable))
$running = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {
  [string]::Equals($_.Path, $desktopPath, [StringComparison]::OrdinalIgnoreCase)
})
$windows = @($running | ForEach-Object { Get-Process -Id $_.Id -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne 0 })
if ($windows.Count -eq 1) {
  # ActivateApplication can route an already open app back to its home page.
  # Focus its verified existing window instead, preserving the selected chat.
  if (!('TokenBarLaunch.Window' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace TokenBarLaunch {
  public static class Window {
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  }
}
'@
  }
  $handle = $windows[0].MainWindowHandle
  if ([TokenBarLaunch.Window]::IsIconic($handle)) { [void][TokenBarLaunch.Window]::ShowWindowAsync($handle, 9) }
  [void][TokenBarLaunch.Window]::SetForegroundWindow($handle)
  [pscustomobject]@{ originalOnly = [bool]$OriginalOnly; packageVersion = [string]$package.Version }
  return
}
# Compatibility is checked against live identifiers, layout and usage records,
# rather than a release number. Original mode never enables debugging.
$arguments = if (!$OriginalOnly) { '--remote-debugging-address=127.0.0.1 --remote-debugging-port=9337' } else { '' }
if (!('TokenBarLaunch.Activation' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace TokenBarLaunch {
  [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IApplicationActivationManager {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string args, int options, out uint processId);
  }
  [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] class ApplicationActivationManager {}
  public static class Activation {
    public static void Open(string id, string args) {
      uint processId;
      Marshal.ThrowExceptionForHR(((IApplicationActivationManager)new ApplicationActivationManager()).ActivateApplication(id, args, 2, out processId));
    }
  }
}
'@
}
[TokenBarLaunch.Activation]::Open("$($package.PackageFamilyName)!$($apps[0].Id)", $arguments)
[pscustomobject]@{ originalOnly = [bool]$OriginalOnly; packageVersion = [string]$package.Version }
