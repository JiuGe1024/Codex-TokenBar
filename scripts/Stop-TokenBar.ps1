$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
[void](New-Item -ItemType Directory -Path (Join-Path $root 'work') -Force)
'stop' | Set-Content -LiteralPath (Join-Path $root 'work\tokenbar.stop') -Encoding utf8
