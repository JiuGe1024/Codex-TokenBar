[CmdletBinding()]
param([switch]$AttachOnly, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($CheckOnly) { & (Join-Path $PSScriptRoot 'TokenBar-Probe.ps1') -CheckOnly; return }
$mutex = [Threading.Mutex]::new($false, 'Local\CodexTokenBar.CurrentUser.' + $env:USERNAME)
$ownsMutex = $false
$reconnects = 0
$failurePhase = 'startup-failed'
function Write-LifecycleState([string]$Phase, [string]$Reason) {
  $state = @{ phase=$Phase; reason=$Reason; updatedAt=[DateTime]::UtcNow.ToString('o'); reconnects=$reconnects; supervisorPid=$PID } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $root 'work\tokenbar-state.json'), $state)
}
try {
  # On a rapid reopen the previous backend may still be unwinding its CDP
  # timeout. Allow that owner to exit instead of dropping the new launch.
  try { $ownsMutex = $mutex.WaitOne(10000) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (!$ownsMutex) { return }
  [void](New-Item -ItemType Directory -Path (Join-Path $root 'work') -Force)
  $node = (& (Join-Path $PSScriptRoot 'Resolve-Node.ps1'))
  $stopPath = Join-Path $root 'work\tokenbar.stop'
  if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath }
  if (!$AttachOnly) {
    $null = & (Join-Path $PSScriptRoot 'Open-Codex.ps1')
  }
  $probe = Join-Path $PSScriptRoot 'TokenBar-Probe.ps1'
  # Cold launch may expose its listener before its main renderer is ready.
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  do {
    if (Test-Path -LiteralPath $stopPath) { Write-LifecycleState 'stopped' 'stop-requested'; return }
    try { $inspection = @(& $probe -Mode Inspect); break }
    catch { if ($AttachOnly -or [DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 1000 }
  } while ($true)
  if (!$inspection.Count) { throw 'Renderer inspection failed.' }
  if (Test-Path -LiteralPath $stopPath) { Write-LifecycleState 'stopped' 'stop-requested'; return }
  $localStartup = Join-Path $PSScriptRoot 'Start-TokenBar.local.ps1'
  if (Test-Path -LiteralPath $localStartup) { & $localStartup }
  $initialFailures = 0
  $wasAttached = $false
  $retryDelays = @(1000, 2000, 4000)
  do {
    if (Test-Path -LiteralPath $stopPath) { Write-LifecycleState 'stopped' 'stop-requested'; return }
    # Re-discover the Store package and validate every listener owner before
    # starting another transport, including retries during initial attachment.
    try { $verified = (& $probe -VerifyOnly | ConvertFrom-Json) }
    catch { $failurePhase = 'validation-failed'; throw }
    if (!$verified.officialRunning) { Write-LifecycleState 'stopped' 'codex-exited'; return }
    $runtimeCode = 1
    if ($verified.cdpAvailable) {
      & $node (Join-Path $PSScriptRoot 'run-tokenbar.mjs') 9337
      $runtimeCode = $LASTEXITCODE
      if ($runtimeCode -eq 0 -or $runtimeCode -eq 4) { return }
      if ($runtimeCode -eq 2) { $wasAttached = $true }
      elseif ($runtimeCode -ne 1) { throw 'TokenBar runtime failed. See work/tokenbar-state.json.' }
    }
    if ($wasAttached) {
      if ($reconnects -ge 3) { Write-LifecycleState 'reconnect-exhausted' 'retry-limit-reached'; exit 2 }
      $delay = $retryDelays[$reconnects]
      $reconnects++
    } else {
      $initialFailures++
      if ($initialFailures -ge 3) { throw 'TokenBar could not attach after three verified attempts. See work/tokenbar-state.json.' }
      $delay = $retryDelays[$initialFailures - 1]
    }
    Write-LifecycleState 'reconnecting' 'transport-unavailable'
    $retryAt = [DateTime]::UtcNow.AddMilliseconds($delay)
    do {
      if (Test-Path -LiteralPath $stopPath) { Write-LifecycleState 'stopped' 'stop-requested'; return }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $retryAt)
  } while ($true)
} catch {
  $work = Join-Path $root 'work'
  [void](New-Item -ItemType Directory -Path $work -Force)
  if ($ownsMutex) { Write-LifecycleState $failurePhase 'startup-validation-or-attach-failed' }
  [IO.File]::WriteAllText((Join-Path $work 'tokenbar-start-error.txt'), [DateTime]::UtcNow.ToString('o') + "`n" + $_.Exception.Message)
  throw
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
