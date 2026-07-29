@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title FocusFlow Local Preview

echo.
echo ========================================
echo        FocusFlow Local Preview
echo ========================================
echo.

if not exist "package.json" goto missing_project

where node >nul 2>nul
if errorlevel 1 goto missing_node

for /f "delims=" %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto node_error
if %NODE_MAJOR% LSS 22 goto old_node

if /I "%~1"=="--check" (
  echo Start-FocusFlow.cmd check passed.
  exit /b 0
)

set "AUTO_INSTALL=0"
set "INSTALL_ONLY=0"
if /I "%~1"=="--ci-install" (
  set "AUTO_INSTALL=1"
  set "INSTALL_ONLY=1"
)

if not exist ".env" (
  if not exist ".env.example" goto missing_env
  copy /Y ".env.example" ".env" >nul
  echo Created local .env from .env.example.
)

if not exist "node_modules" (
  echo.
  echo Project dependencies are not installed yet.
  echo The next step downloads packages from the npm registry.
  if "%AUTO_INSTALL%"=="0" (
    choice /C YN /N /M "Install dependencies now? [Y/N]: "
    if errorlevel 2 goto cancelled
  )

  echo.
  if exist "package-lock.json" (
    echo Running npm ci --no-audit --no-fund ...
    call npm.cmd ci --no-audit --no-fund
  ) else (
    echo No package-lock.json found. Running npm install --no-audit --no-fund ...
    call npm.cmd install --no-audit --no-fund
  )
  if errorlevel 1 goto install_failed
)

if "%INSTALL_ONLY%"=="1" (
  echo Windows dependency installation test passed.
  exit /b 0
)

echo.
echo Starting FocusFlow in a visible command window.
echo Browser address: http://localhost:5173
echo Stop the server with Ctrl+C in the server window.
echo.

start "FocusFlow Dev Server" /D "%~dp0" cmd.exe /k npm.cmd run dev
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"
exit /b 0

:missing_project
echo ERROR: package.json was not found.
echo Extract the complete ZIP before running this file.
goto failed

:missing_node
echo ERROR: Node.js 22 or newer was not found.
echo Install Node.js from its official website, then try again.
goto failed

:node_error
echo ERROR: Could not read the Node.js version.
goto failed

:old_node
echo ERROR: Node.js 22 or newer is required. Current major version: %NODE_MAJOR%
goto failed

:missing_env
echo ERROR: .env.example was not found.
goto failed

:install_failed
echo ERROR: npm dependency installation failed.
echo Review the npm error shown above.
goto failed

:cancelled
echo.
echo Cancelled. Nothing was installed or started.
exit /b 0

:failed
echo.
pause
exit /b 1
