import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('Shell shortcut grouping identity round-trips without changing launch target or arguments', { skip: process.platform !== 'win32' }, async () => {
  const work = path.resolve('work');
  await fs.mkdir(work, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(work, 'taskbar-test-'));
  try {
    const command = `
      $ErrorActionPreference = 'Stop'
      Add-Type -Path $env:TOKENBAR_TEST_SOURCE
      $path = Join-Path $env:TOKENBAR_TEST_FIXTURE 'test.lnk'
      $shell = New-Object -ComObject WScript.Shell
      $link = $shell.CreateShortcut($path)
      $link.TargetPath = Join-Path $env:WINDIR 'notepad.exe'
      $link.Arguments = '--fixture "a b"'
      $link.WorkingDirectory = $env:TOKENBAR_TEST_FIXTURE
      $link.Description = 'TokenBar test fixture'
      $link.Save()
      $original = [TokenBar.TaskbarIdentity]::ReadShortcut($path)
      [TokenBar.TaskbarIdentity]::SetShortcut($path, 'Codex.TokenBar.Test')
      $assigned = [TokenBar.TaskbarIdentity]::ReadShortcut($path)
      $read = $shell.CreateShortcut($path)
      $targetPreserved = $read.TargetPath -eq $link.TargetPath
      [TokenBar.TaskbarIdentity]::SetShortcut($path, $original)
      [pscustomobject]@{original=$original;assigned=$assigned;restored=[TokenBar.TaskbarIdentity]::ReadShortcut($path);targetPreserved=$targetPreserved;arguments=$read.Arguments;description=$read.Description;workingDirectory=$read.WorkingDirectory} | ConvertTo-Json -Compress
    `;
    const shell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true, timeout: 15000,
      env: { ...process.env, TOKENBAR_TEST_SOURCE: path.resolve('src/TaskbarIdentity.cs'), TOKENBAR_TEST_FIXTURE: fixture },
    });
    const result = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    assert.equal(result.original, null);
    assert.equal(result.assigned, 'Codex.TokenBar.Test');
    assert.equal(result.restored, null);
    assert.equal(result.targetPreserved, true);
    assert.equal(result.arguments, '--fixture "a b"');
    assert.equal(result.description, 'TokenBar test fixture');
    assert.equal(result.workingDirectory.toLowerCase(), fixture.toLowerCase());
  } finally {
    const relative = path.relative(work, fixture);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture cleanup');
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
