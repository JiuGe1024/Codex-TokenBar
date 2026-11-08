[CmdletBinding()]
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $root 'work\direct-launch-state.json'
function Write-LaunchState([string]$Phase, [string]$Detail) {
  [pscustomobject]@{ phase=$Phase; detail=$Detail; updatedAt=[DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}
try {
  if ($CheckOnly) {
    $preflight = @(& (Join-Path $PSScriptRoot 'TokenBar-Probe.ps1') -CheckOnly)
    [void](($preflight -join [Environment]::NewLine) | ConvertFrom-Json)
    Write-LaunchState 'preflight-passed' 'Launcher can run the local checks. Codex was not started or closed.'
    exit 0
  }
  Write-LaunchState 'starting' 'Starting the verified registered Codex app and inspecting DOM structure only.'
  $result = @(& (Join-Path $PSScriptRoot 'TokenBar-Probe.ps1') -Mode Inspect -Launch)
  $report = ($result -join [Environment]::NewLine) | ConvertFrom-Json
  if (!$report.candidates -or !$report.viewport) { throw 'No valid DOM structure report was returned.' }
  $report | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $root 'outputs\layout-live.json') -Encoding utf8
  Write-LaunchState 'inspection-complete' 'DOM structure saved. Static mounting and Token data are not yet enabled.'
  exit 0
} catch {
  Write-LaunchState 'failed' ([string]$_.Exception.Message)
  [Console]::Error.WriteLine([string]$_.Exception.Message)
  exit 1
}
