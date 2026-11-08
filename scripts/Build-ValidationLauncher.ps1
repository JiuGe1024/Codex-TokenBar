$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework compiler is unavailable.' }
$target = Join-Path $root 'outputs\TokenBar-Validation.exe'
$source = Join-Path $root 'src\ValidationLauncher.cs'
& $compiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll "/out:$target" $source
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Get-FileHash -LiteralPath $target -Algorithm SHA256 | Select-Object Path,Hash
