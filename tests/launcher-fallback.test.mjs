import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('launcher enables restricted CDP independent of version; original mode never adds debug flags', { skip: process.platform !== 'win32' }, async () => {
  const work = path.resolve('work');
  await fs.mkdir(work, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(work, 'launcher-test-'));
  try {
    await fs.writeFile(path.join(fixture, 'AppxManifest.xml'), '<Package><Applications><Application Id="App" Executable="app/ChatGPT.exe" /></Applications></Package>');
    // Replace activation with a recording stub before loading the production
    // script. These cases cannot launch an application or open a CDP port.
    const command = `
      $ErrorActionPreference = 'Stop'
      Add-Type 'namespace TokenBarLaunch { public static class Activation { public static string Arguments; public static void Open(string id,string args) { Arguments=args; } } }'
      function Get-AppxPackage { param($Name) [pscustomobject]@{Version=$global:tokenBarFixtureVersion;InstallLocation=$env:TOKENBAR_TEST_FIXTURE;PackageFamilyName='Test.Family'} }
      function Get-CimInstance { throw 'WMI must not be used by the launcher' }
      function Get-Process { param($Name,$ErrorAction) @() }
      $results = @()
      foreach ($case in @(@('26.1013.4894.0',$false),@('99.0.0.0',$false),@('26.1013.4894.0',$true),@('26.1021.3705.0',$false),@('26.1021.3705.0',$true))) {
        $global:tokenBarFixtureVersion = $case[0]
        $result = & $env:TOKENBAR_TEST_SCRIPT -OriginalOnly:([bool]$case[1])
        $results += [pscustomobject]@{version=$result.packageVersion;arguments=[TokenBarLaunch.Activation]::Arguments}
      }
      ConvertTo-Json -InputObject $results -Compress
    `;
    const shell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true, timeout: 15000,
      env: { ...process.env, TOKENBAR_TEST_FIXTURE: fixture, TOKENBAR_TEST_SCRIPT: path.resolve('scripts/Open-Codex.ps1') },
    });
    const results = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    assert.equal(results[0].version, '26.1013.4894.0');
    assert.equal(results[0].arguments, '--remote-debugging-address=127.0.0.1 --remote-debugging-port=9337');
    assert.equal(results[1].version, '99.0.0.0');
    assert.equal(results[1].arguments, '--remote-debugging-address=127.0.0.1 --remote-debugging-port=9337');
    assert.equal(results[2].arguments, '');
    assert.equal(results[3].version, '26.1021.3705.0');
    assert.equal(results[3].arguments, '--remote-debugging-address=127.0.0.1 --remote-debugging-port=9337');
    assert.equal(results[4].arguments, '');
  } finally {
    const relative = path.relative(work, fixture);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture cleanup');
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
