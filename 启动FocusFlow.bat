@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title FocusFlow 本地预览

echo.
echo ========================================
echo       FocusFlow 一键启动程序
echo ========================================
echo.

if not exist "package.json" (
  echo [错误] 当前目录缺少 package.json。
  echo 请先完整解压项目 ZIP，再双击本文件。
  goto :failed
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo 请安装 Node.js 22 或更高版本后重试。
  start "" "https://nodejs.org/"
  goto :failed
)

for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :node_error
if %NODE_MAJOR% LSS 22 (
  echo [错误] 当前 Node.js 主版本为 %NODE_MAJOR%，项目要求 22 或更高版本。
  start "" "https://nodejs.org/"
  goto :failed
)

if not exist ".env" (
  if not exist ".env.example" (
    echo [错误] 缺少 .env.example。
    goto :failed
  )
  copy /Y ".env.example" ".env" >nul
  echo [完成] 已自动创建本地环境配置 .env
)

echo [1/2] 正在检查并安装依赖，首次运行可能需要几分钟...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [错误] 依赖安装失败。请检查网络后重新双击本文件。
  goto :failed
)

echo.
echo [2/2] 正在启动 FocusFlow...
echo 浏览器将自动打开 http://localhost:5173
echo 关闭服务时，请回到此窗口按 Ctrl+C。
echo.
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:5173'"
call npm.cmd run dev
goto :end

:node_error
echo [错误] 无法读取 Node.js 版本。

:failed
echo.
pause
exit /b 1

:end
endlocal
