@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install Node.js LTS, then run this file again.
  pause
  exit /b 1
)
start "Product Image Studio" http://127.0.0.1:5177
node server.js
