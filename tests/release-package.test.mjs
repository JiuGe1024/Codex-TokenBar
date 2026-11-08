import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const run = promisify(execFile);
const windows = { skip: process.platform !== 'win32' };
async function fixture(prefix) {
  await fs.mkdir('work', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('work/' + prefix));
  return { root, async cleanup() {
    if (path.dirname(root) !== path.resolve('work')) throw new Error('Unsafe cleanup');
    await fs.rm(root, { recursive: true, force: true });
  } };
}

test('Node resolver verifies the installed runtime and reports missing dependency clearly', windows, async () => {
  const resolved = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/Resolve-Node.ps1')], { windowsHide: true });
  assert.ok(await fs.stat(resolved.stdout.trim()));
  let failure;
  try {
    await run(path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/Resolve-Node.ps1')], { windowsHide: true, env: { ...process.env, PATH: path.join(process.env.WINDIR, 'System32') } });
  } catch (error) { failure = error; }
  assert.equal(failure.code, 1);
  assert.match(failure.stderr, /nodejs\.org/);
});

test('portable ZIP contains relocatable entrypoints and excludes local data; checksum matches', windows, async () => {
  const f = await fixture('package-test-');
  try {
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/Build-Release.ps1'), '-SkipTests', '-OutputDirectory', f.root], { windowsHide: true, timeout: 30000 });
    const archive = (await fs.readdir(f.root)).find(n => n.endsWith('.zip'));
    const data = await fs.readFile(path.join(f.root, archive));
    const checksum = await fs.readFile(path.join(f.root, archive + '.sha256'), 'utf8');
    assert.equal(checksum.split(' ')[0], createHash('sha256').update(data).digest('hex'));
    const unpack = path.join(f.root, 'unpacked');
    await run('powershell.exe', ['-NoProfile', '-Command', `Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive') -Force; Expand-Archive -LiteralPath '${path.join(f.root, archive)}' -DestinationPath '${unpack}'`], { windowsHide: true, timeout: 15000 });
    const root = path.join(unpack, 'Codex-TokenBar');
    for (const file of ['Codex-TokenBar.exe', '环境检查.exe', '创建快捷方式.exe', '关闭统计.exe', '打开原版.exe', 'scripts/Resolve-Node.ps1', 'scripts/Setup-TokenBar.ps1', 'src/cdp.mjs', 'docs/usage.md']) await fs.access(path.join(root, file));
    for (const file of ['work', 'node_modules', 'STATE.md', 'HANDOFF.md', 'scripts/Start-TokenBar.local.ps1', '.git']) await assert.rejects(fs.access(path.join(root, file)));
    // Exercise filename dispatch and root-directory resolution with an isolated stop stub.
    await fs.writeFile(path.join(root, 'scripts/Stop-TokenBar.ps1'), "Set-Content -LiteralPath (Join-Path $PSScriptRoot '../stopped') -Value 'yes'\n");
    await run(path.join(root, '关闭统计.exe'), [], { windowsHide: true, timeout: 10000 });
    assert.equal((await fs.readFile(path.join(root, 'stopped'), 'utf8')).trim(), 'yes');
  } finally { await f.cleanup(); }
});

test('first-time setup creates shortcuts in the extracted directory without a preexisting outputs folder', windows, async () => {
  const f = await fixture('setup-test-');
  try {
    await fs.mkdir(path.join(f.root, 'scripts'));
    await fs.mkdir(path.join(f.root, 'src'));
    await fs.mkdir(path.join(f.root, 'package'));
    for (const name of ['Setup-TokenBar.ps1', 'Test-Environment.ps1', 'Resolve-Node.ps1', 'Configure-Taskbar.ps1']) await fs.copyFile('scripts/' + name, path.join(f.root, 'scripts', name));
    await fs.copyFile('src/TaskbarIdentity.cs', path.join(f.root, 'src/TaskbarIdentity.cs'));
    await fs.writeFile(path.join(f.root, 'Codex-TokenBar.exe'), 'fixture');
    await fs.writeFile(path.join(f.root, 'package/AppxManifest.xml'), '<Package><Applications><Application Id="App" Executable="app\\ChatGPT.exe" /></Applications></Package>');
    await fs.writeFile(path.join(f.root, 'scripts/TokenBar-Probe.ps1'), `'{"packageVersion":"1.0","cdpAvailable":false}'`);
    const script = path.join(f.root, 'setup-fixture.ps1');
    await fs.writeFile(script, `\ufefffunction Get-AppxPackage { [pscustomobject]@{InstallLocation='${path.join(f.root, 'package')}'} }\n& '${path.join(f.root, 'scripts/Setup-TokenBar.ps1')}'\nif($LASTEXITCODE -ne 0){exit 1}\n$s=New-Object -ComObject WScript.Shell\n'LINK_TARGET='+$s.CreateShortcut('${path.join(f.root, 'outputs/Codex-TokenBar.lnk')}').TargetPath\n`);
    const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, timeout: 15000 });
    assert.match(result.stdout, /LINK_TARGET=/);
    assert.ok(result.stdout.includes(path.join(f.root, 'Codex-TokenBar.exe')));
    for (const name of ['Codex-TokenBar', '关闭统计', '打开原版', '环境检查']) await fs.access(path.join(f.root, 'outputs', name + '.lnk'));
  } finally { await f.cleanup(); }
});
