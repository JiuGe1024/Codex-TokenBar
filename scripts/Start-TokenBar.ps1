[CmdletBinding()]
param([switch]$AttachOnly, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($CheckOnly) { & (Join-Path $PSScriptRoot 'TokenBar-Probe.ps1') -CheckOnly; return }
$mutex = [Threading.Mutex]::new($false, 'Local\CodexTokenBar.CurrentUser.' + $env:USERNAME)
$ownsMutex = $false
try {
  # On a rapid reopen the previous backend may still be unwinding its CDP
  # timeout. Allow that owner to exit instead of dropping the new launch.
  try { $ownsMutex = $mutex.WaitOne(10000) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (!$ownsMutex) { return }
  if (!$AttachOnly) {
    $null = & (Join-Path $PSScriptRoot 'Open-Codex.ps1')
  }
  $probe = Join-Path $PSScriptRoot 'TokenBar-Probe.ps1'
  # Cold launch may expose its listener before its main renderer is ready.
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  do {
    try { $inspection = @(& $probe -Mode Inspect); break }
    catch { if ($AttachOnly -or [DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 1000 }
  } while ($true)
  if (!$inspection.Count) { throw 'Renderer inspection failed.' }
  $stopPath = Join-Path $root 'work\tokenbar.stop'
  if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath }
  $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $localStartup = Join-Path $PSScriptRoot 'Start-TokenBar.local.ps1'
  if (Test-Path -LiteralPath $localStartup) { & $localStartup }
  & $node (Join-Path $PSScriptRoot 'run-tokenbar.mjs') 9337
  # 2 means an already attached runtime lost its connection. It is recorded
  # in the status file, not reported as a failure to start Codex.
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 2) { throw 'TokenBar could not attach. See work/tokenbar-state.json.' }
} catch {
  $work = Join-Path $root 'work'
  [void](New-Item -ItemType Directory -Path $work -Force)
  [IO.File]::WriteAllText((Join-Path $work 'tokenbar-start-error.txt'), [DateTime]::UtcNow.ToString('o') + "`n" + $_.Exception.Message)
  throw
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
