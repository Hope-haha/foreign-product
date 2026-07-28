@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-local-models.ps1"
if errorlevel 1 (
  echo Setup failed. Please check README.md for requirements and try again.
  pause
  exit /b 1
)
echo Setup complete. Double-click start-studio.cmd to open the website.
pause
