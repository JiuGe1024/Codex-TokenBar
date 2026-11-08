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
  await fs.mkdir(path.join(root, 'work'));
  return { root, async cleanup() {
    const relative = path.relative(work, root);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe fixture cleanup');
    await fs.rm(root, { recursive: true, force: true });
  } };
}

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
          const value=request.id===3?{disabled:true}:{ok:true};
          this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:request.id,result:{result:{value}}})}));
        })}
        close(){this.readyState=3;this.dispatchEvent(new Event('close'))}
      };
    `);
    for (const [scenario, expectedCode, expectedPhase] of [['initial', 1, 'disconnected-or-failed'], ['transient', 0, 'stopped'], ['disconnect', 2, 'disconnected-or-failed'], ['stop', 0, 'stopped']]) {
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

test('rapid reopen waits for retiring owner and runtime disconnect does not fail startup', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  let holder;
  try {
    // Only isolate the mutex name in the copied production entry. No live
    // Codex process, listener, launcher or production mutex is touched.
    const prefix = 'CodexTokenBar.Test.' + path.basename(f.root) + '.';
    const source = (await fs.readFile('scripts/Start-TokenBar.ps1', 'utf8')).replace('CodexTokenBar.CurrentUser.', prefix);
    await fs.writeFile(path.join(f.root, 'scripts/Start-TokenBar.ps1'), source);
    await fs.writeFile(path.join(f.root, 'scripts/TokenBar-Probe.ps1'), "param([string]$Mode)\n'fixture-inspection'\n");
    await fs.writeFile(path.join(f.root, 'scripts/run-tokenbar.mjs'), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(f.root, 'work/started'))},'yes');process.exitCode=2;`);
    const shell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    holder = spawn(shell, ['-NoProfile', '-NonInteractive', '-Command', `$m=[Threading.Mutex]::new($false,'Local\\${prefix}'+$env:USERNAME);[void]$m.WaitOne();[Console]::WriteLine('ready');[Threading.Thread]::Sleep(2200);$m.ReleaseMutex();$m.Dispose()`], { windowsHide: true });
    await new Promise((resolve, reject) => {
      holder.stdout.once('data', resolve);
      holder.once('error', reject);
      holder.once('exit', code => { if (code) reject(new Error('Fixture owner failed')); });
    });
    await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.root, 'scripts/Start-TokenBar.ps1'), '-AttachOnly'], { windowsHide: true, timeout: 15000 });
    assert.equal(await fs.readFile(path.join(f.root, 'work/started'), 'utf8'), 'yes');
    await assert.rejects(fs.access(path.join(f.root, 'work/tokenbar-start-error.txt')));
  } finally {
    if (holder && holder.exitCode === null) await new Promise(resolve => holder.once('exit', resolve));
    await f.cleanup();
  }
});
