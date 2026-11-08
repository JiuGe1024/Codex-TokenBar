import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('EXE rejects repeated launches before creating another backend; disconnect exits without a dialog', {skip: process.platform !== 'win32'}, async () => {
  const root = await fs.mkdtemp(path.resolve('work/launcher-exe-test-'));
  let owner;
  try {
    await fs.mkdir(path.join(root, 'outputs'));
    await fs.mkdir(path.join(root, 'scripts'));
    const source = (await fs.readFile('src/TokenBarLauncher.cs', 'utf8')).replace('CodexTokenBar.Launcher.', `CodexTokenBar.Test.${path.basename(root)}.`);
    await fs.writeFile(path.join(root, 'Launcher.cs'), source);
    await fs.writeFile(path.join(root, 'scripts/Start-TokenBar.ps1'), "$ErrorActionPreference='Stop'\nAdd-Content -LiteralPath (Join-Path $PSScriptRoot '../started.txt') -Value 'started'\nStart-Sleep -Seconds 4\nexit 2\n");
    const exe = path.join(root, 'outputs/Codex-TokenBar.exe');
    await promisify(execFile)(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:winexe', '/platform:x64', '/reference:System.Windows.Forms.dll', `/out:${exe}`, path.join(root, 'Launcher.cs')], {windowsHide:true,timeout:15000});
    owner = spawn(exe, [], {windowsHide:true});
    const finished = new Promise((resolve,reject) => {owner.once('exit',resolve);owner.once('error',reject)});
    let ready=false;
    for(let i=0;i<50;i++){try {await fs.access(path.join(root,'started.txt'));ready=true;break}catch{await new Promise(r=>setTimeout(r,50))}}
    assert.ok(ready, 'owner backend started');
    await Promise.all(Array.from({length:8},()=>promisify(execFile)(exe,[],{windowsHide:true,timeout:2000})));
    assert.equal((await fs.readFile(path.join(root,'started.txt'),'utf8')).trim().split(/\r?\n/).length,1);
    const exitCode=await Promise.race([finished,new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('launcher did not exit')),7000);t.unref()})]);
    assert.equal(exitCode,2);
  } finally {
    if(owner && owner.exitCode === null) owner.kill();
    if(!path.basename(root).startsWith('launcher-exe-test-') || path.dirname(root)!==path.resolve('work')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(root,{recursive:true,force:true});
  }
});
