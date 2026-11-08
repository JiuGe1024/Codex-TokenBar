[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$command = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$command) { throw '请先安装 Node.js 22 或更新版本（推荐 LTS），然后重新双击 Codex-TokenBar.exe。下载地址 https://nodejs.org/' }
$node = $command.Source
$version = & $node -e "if(Number(process.versions.node.split('.')[0])<22||typeof fetch!=='function'||typeof WebSocket!=='function')process.exit(1);console.log(process.versions.node)"
if ($LASTEXITCODE -ne 0 -or !$version) { throw '当前 Node.js 版本无法运行 TokenBar。请安装 Node.js 22+（推荐 LTS），再重新双击 Codex-TokenBar.exe。下载地址 https://nodejs.org/' }
$node
