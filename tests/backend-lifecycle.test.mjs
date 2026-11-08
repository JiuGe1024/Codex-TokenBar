import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

async function fixture() {
  const work = path.resolve('work');
  await fs.mkdir(work, { recursive: true });
  const root = await fs.mkdtemp(path.join(work, 'lifecycle-test-'));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile('scripts/Resolve-Node.ps1', path.join(root, 'scripts/Resolve-Node.ps1'));
  await fs.mkdir(path.join(root, 'work'));
  return { root, async cleanup() {
    const relative = path.relative(work, root);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture cleanup');
    await fs.rm(root, { recursive: true, force: true });
  } };
}

test('direct startup reports a missing dependency before opening Codex', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    const source = (await fs.readFile('scripts/Start-TokenBar.ps1', 'utf8'))
      .replace('CodexTokenBar.CurrentUser.', `CodexTokenBar.Test.${path.basename(f.root)}.`);
    await fs.writeFile(path.join(f.root, 'scripts/Start-TokenBar.ps1'), source);
    await fs.writeFile(path.join(f.root, 'scripts/Resolve-Node.ps1'), "throw 'Install Node.js https://nodejs.org/'\n");
    await fs.writeFile(path.join(f.root, 'scripts/Open-Codex.ps1'), "Set-Content -LiteralPath (Join-Path $PSScriptRoot '../opened') -Value 'yes'\n");
    await assert.rejects(promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.root, 'scripts/Start-TokenBar.ps1')], { windowsHide: true, timeout: 10000 }));
    await assert.rejects(fs.access(path.join(f.root, 'opened')));
    assert.match(await fs.readFile(path.join(f.root, 'work/tokenbar-start-error.txt'), 'utf8'), /nodejs\.org/);
  } finally { await f.cleanup(); }
});

test('runtime distinguishes initial attach failure, connection loss and explicit stop', async () => {
  const f = await fixture();
  try {
    await fs.cp(path.resolve('src'), path.join(f.root, 'src'), { recursive: true });
    await fs.copyFile('scripts/run-tokenbar.mjs', path.join(f.root, 'scripts/run-tokenbar.mjs'));
    const bootstrap = path.join(f.root, 'fake-cdp.mjs');
    await fs.writeFile(bootstrap, `
      globalThis.fetch=async()=>{
        if(process.env.TOKENBAR_SCENARIO==='initial') throw new Error('fixture discovery unavailable');
        return {ok:true,text:async()=>JSON.stringify([{type:'page',url:'app://-/index.html',webSocketDebuggerUrl:'ws://127.0.0.1:9337/devtools/page/FIXTURE'}])};
      };
      globalThis.WebSocket=class extends EventTarget {
        static OPEN=1; static attempts=0; readyState=0;
        constructor(){super();const attempt=++WebSocket.attempts;queueMicrotask(()=>{
          if(process.env.TOKENBAR_SCENARIO==='transient'&&attempt<3){this.readyState=3;this.dispatchEvent(new Event('error'));return}
          this.readyState=1;this.dispatchEvent(new Event('open'))
        })}
        send(data){const request=JSON.parse(data);queueMicrotask(()=>{
          if(request.id===3&&process.env.TOKENBAR_SCENARIO==='disconnect'){this.close();return}
          const value=request.id===2&&process.env.TOKENBAR_SCENARIO==='incompatible'?{ok:false,reason:'unsupported-browser-capabilities'}:request.id===3?{disabled:true}:{ok:true};
          this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:request.id,result:{result:{value}}})}));
        })}
        close(){this.readyState=3;this.dispatchEvent(new Event('close'))}
      };
    `);
    for (const [scenario, expectedCode, expectedPhase] of [['initial', 1, 'disconnected-or-failed'], ['transient', 1, 'disconnected-or-failed'], ['disconnect', 2, 'disconnected-or-failed'], ['incompatible', 4, 'incompatible-or-failed'], ['stop', 0, 'stopped'], ['pending-stop', 0, 'stopped']]) {
      if (scenario === 'pending-stop') await fs.writeFile(path.join(f.root, 'work/tokenbar.stop'), 'stop');
      let code = 0;
      try {
        await promisify(execFile)(process.execPath, ['--import', pathToFileURL(bootstrap).href, path.join(f.root, 'scripts/run-tokenbar.mjs')], {
          windowsHide: true, timeout: 10000, env: { ...process.env, TOKENBAR_SCENARIO: scenario },
        });
      } catch (error) { code = error.code; }
      assert.equal(code, expectedCode, scenario);
      const state = JSON.parse(await fs.readFile(path.join(f.root, 'work/tokenbar-state.json'), 'utf8'));
      assert.equal(state.phase, expectedPhase, scenario);
    }
  } finally { await f.cleanup(); }
});

test('supervisor revalidates each attempt, bounds retries, stops on exit and rejects unsafe listeners', { skip: process.platform !== 'win32' }, async () => {
  for (const [scenario, expectedCode, launches, checks] of [
    ['recover', 0, 2, 2], ['initial', 0, 3, 3], ['exhaust', 2, 4, 4],
    ['exit', 0, 1, 2], ['unsafe', 1, 1, 2], ['incompatible', 0, 1, 1], ['cancel', 0, 1, 1], ['missing', 2, 1, 4],
  ]) {
    const f = await fixture();
    try {
      const source = (await fs.readFile('scripts/Start-TokenBar.ps1', 'utf8'))
        .replace('CodexTokenBar.CurrentUser.', `CodexTokenBar.Test.${path.basename(f.root)}.`)
        .replace('@(1000, 2000, 4000)', '@(50, 100, 200)');
      await fs.writeFile(path.join(f.root, 'scripts/Start-TokenBar.ps1'), source);
      await fs.writeFile(path.join(f.root, 'scenario'), scenario);
      await fs.writeFile(path.join(f.root, 'scripts/TokenBar-Probe.ps1'), `
        param([string]$Mode,[switch]$VerifyOnly)
        if (!$VerifyOnly) { 'fixture-inspection'; return }
        $root = Split-Path -Parent $PSScriptRoot
        Add-Content -LiteralPath (Join-Path $root 'checks') -Value 'verified'
        $scenario = Get-Content (Join-Path $root 'scenario')
        $launched = Test-Path (Join-Path $root 'launches')
        if ($scenario -eq 'unsafe' -and $launched) { throw 'fixture unsafe listener rejected' }
        @{ officialRunning= !($scenario -eq 'exit' -and $launched); cdpAvailable= !($scenario -eq 'missing' -and $launched) } | ConvertTo-Json
      `);
      await fs.writeFile(path.join(f.root, 'scripts/run-tokenbar.mjs'), `
        import fs from 'node:fs';
        const root=${JSON.stringify(f.root)};
        const scenario=fs.readFileSync(root+'/scenario','utf8');
        const file=root+'/launches';
        const count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8'))+1:1;
        fs.writeFileSync(file,String(count));
        if(scenario==='cancel')fs.writeFileSync(root+'/work/tokenbar.stop','stop');
        process.exitCode=scenario==='incompatible'?4:scenario==='initial'?(count<3?1:0)
          :scenario==='recover'&&count>1?0:2;
      `);
      let code = 0;
      try {
        await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.root, 'scripts/Start-TokenBar.ps1'), '-AttachOnly'], { windowsHide: true, timeout: 15000 });
      } catch (error) { code = error.code; }
      assert.equal(code, expectedCode, scenario);
      assert.equal(Number(await fs.readFile(path.join(f.root, 'launches'), 'utf8')), launches, scenario);
      assert.equal((await fs.readFile(path.join(f.root, 'checks'), 'utf8')).trim().split(/\r?\n/).length, checks, scenario);
      if (scenario === 'exhaust' || scenario === 'exit' || scenario === 'unsafe' || scenario === 'cancel') {
        const state = JSON.parse((await fs.readFile(path.join(f.root, 'work/tokenbar-state.json'), 'utf8')).replace(/^\uFEFF/, ''));
        assert.equal(state.phase, scenario === 'exhaust' ? 'reconnect-exhausted' : scenario === 'unsafe' ? 'validation-failed' : 'stopped', scenario);
      }
    } finally { await f.cleanup(); }
  }
});

test('rapid reopen waits for retiring owner and runtime disconnect does not fail startup', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  let holder;
  try {
    // Only isolate the mutex name in the copied production entry. No live
    // Codex process, listener, launcher or production mutex is touched.
    const prefix = 'CodexTokenBar.Test.' + path.basename(f.root) + '.';
    const source = (await fs.readFile('scripts/Start-TokenBar.ps1', 'utf8')).replace('CodexTokenBar.CurrentUser.', prefix);
    await fs.writeFile(path.join(f.root, 'scripts/Start-TokenBar.ps1'), source);
    await fs.writeFile(path.join(f.root, 'scripts/TokenBar-Probe.ps1'), "param([string]$Mode,[switch]$VerifyOnly)\nif($VerifyOnly){'{\"officialRunning\":true,\"cdpAvailable\":true}'}else{'fixture-inspection'}\n");
    await fs.writeFile(path.join(f.root, 'scripts/run-tokenbar.mjs'), `import fs from 'node:fs';const file=${JSON.stringify(path.join(f.root, 'work/started'))};const existed=fs.existsSync(file);fs.writeFileSync(file,'yes');process.exitCode=existed?0:2;`);
    const shell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    holder = spawn(shell, ['-NoProfile', '-NonInteractive', '-Command', `$m=[Threading.Mutex]::new($false,'Local\\${prefix}'+$env:USERNAME);[void]$m.WaitOne();[Console]::WriteLine('ready');[Threading.Thread]::Sleep(2200);$m.ReleaseMutex();$m.Dispose()`], { windowsHide: true });
    await new Promise((resolve, reject) => {
      holder.stdout.once('data', resolve);
      holder.once('error', reject);
      holder.once('exit', code => { if (code) reject(new Error('Fixture owner failed')); });
    });
    await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.root, 'scripts/Start-TokenBar.ps1'), '-AttachOnly'], { windowsHide: true, timeout: 20000 });
    assert.equal(await fs.readFile(path.join(f.root, 'work/started'), 'utf8'), 'yes');
    await assert.rejects(fs.access(path.join(f.root, 'work/tokenbar-start-error.txt')));
  } finally {
    if (holder && holder.exitCode === null) await new Promise(resolve => holder.once('exit', resolve));
    await f.cleanup();
  }
});

test('stop during cold-start inspection is preserved and prevents launching the backend', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    const source = (await fs.readFile('scripts/Start-TokenBar.ps1', 'utf8'))
      .replace('CodexTokenBar.CurrentUser.', `CodexTokenBar.Test.${path.basename(f.root)}.`);
    await fs.writeFile(path.join(f.root, 'scripts/Start-TokenBar.ps1'), source);
    await fs.writeFile(path.join(f.root, 'scripts/Open-Codex.ps1'), "'fixture-opened'\n");
    await fs.writeFile(path.join(f.root, 'scripts/TokenBar-Probe.ps1'), "Set-Content -LiteralPath (Join-Path $PSScriptRoot '../work/tokenbar.stop') -Value 'stop';throw 'fixture renderer not ready'\n");
    await fs.writeFile(path.join(f.root, 'scripts/run-tokenbar.mjs'), "throw new Error('Backend must not start');\n");
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.root, 'scripts/Start-TokenBar.ps1')], { windowsHide: true, timeout: 10000 });
    const state = JSON.parse(await fs.readFile(path.join(f.root, 'work/tokenbar-state.json'), 'utf8'));
    assert.equal(state.phase, 'stopped');
    assert.equal(state.reason, 'stop-requested');
    await fs.access(path.join(f.root, 'work/tokenbar.stop'));
  } finally { await f.cleanup(); }
});
