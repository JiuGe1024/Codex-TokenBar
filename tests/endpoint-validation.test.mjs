import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('production listener validator rejects wildcard, IPv6, foreign owners and mixed listeners', { skip: process.platform !== 'win32' }, async () => {
  await fs.mkdir('work', { recursive: true });
  const folder = await fs.mkdtemp(path.resolve('work/security-test-'));
  try {
    const script = path.join(folder, 'verify.ps1');
    await fs.writeFile(script, `
      $ErrorActionPreference='Stop'
      $tokens=$null; $errors=$null
      $ast=[Management.Automation.Language.Parser]::ParseFile('${path.resolve('scripts/TokenBar-Probe.ps1').replaceAll("'", "''")}',[ref]$tokens,[ref]$errors)
      if($errors){throw 'Production probe syntax error'}
      $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-TokenBarListener'},$true)
      Invoke-Expression $definition.Extent.Text
      $desktopPath='C:\\official\\ChatGPT.exe'
      function Get-Process { param($Id,$ErrorAction) if($Id -eq 100){[pscustomobject]@{Path=$desktopPath}}elseif($Id -eq 200){[pscustomobject]@{Path='C:\\other\\ChatGPT.exe'}} }
      $official=[pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=100}
      $results=@()
      foreach($listeners in @(@($official),@(),@([pscustomobject]@{LocalAddress='0.0.0.0';OwningProcess=100}),@([pscustomobject]@{LocalAddress='::1';OwningProcess=100}),@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=200}),@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=300}),@($official,[pscustomobject]@{LocalAddress='0.0.0.0';OwningProcess=100}))){
        try{Assert-TokenBarListener $listeners;$results+=$true}catch{$results+=$false}
      }
      ConvertTo-Json -InputObject $results -Compress
    `);
    const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, timeout: 10000 });
    assert.deepEqual(JSON.parse(result.stdout), [true, false, false, false, false, false, false]);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
