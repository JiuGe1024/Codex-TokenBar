@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Build-Release.ps1"
if errorlevel 1 (echo Build failed. & pause & exit /b 1)
echo Build complete. See the outputs folder.
pause
