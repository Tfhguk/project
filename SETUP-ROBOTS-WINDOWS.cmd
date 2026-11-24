@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting the local setup wizard. Keep this window open.
node "local\setup-wizard.cjs" "%CD%"
if errorlevel 1 (echo. & echo Failed to open setup wizard. & pause)
