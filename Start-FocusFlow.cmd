@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title FocusFlow 本地预览

echo.
echo ========================================
echo       FocusFlow 安全启动程序
echo ========================================
echo.
echo 本脚本不会隐藏窗口、不会调用 PowerShell、不会下载或执行陌生文件。
echo 首次安装依赖时会先明确询问，并使用 package-lock.json 固定的 npm 依赖版本。
echo.

if not exist "package.json" (
  echo [错误] 当前目录缺少 package.json。
  echo 请先完整解压项目 ZIP，再双击本文件。
  goto :failed
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js 22 或更高版本。
  echo 请自行从 Node.js 官方网站安装后重试。
  goto :failed
)

for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :node_error
if %NODE_MAJOR% LSS 22 (
  echo [错误] 当前 Node.js 主版本为 %NODE_MAJOR%，项目要求 22 或更高版本。
  goto :failed
)

if not exist ".env" (
  if not exist ".env.example" (
    echo [错误] 缺少 .env.example。
    goto :failed
  )
  copy /Y ".env.example" ".env" >nul
  echo [完成] 已从 .env.example 创建本地 .env。
)

if not exist "node_modules" (
  echo.
  echo [提示] 尚未安装项目依赖。
  echo 下一步会从 npm 官方注册表下载 package-lock.json 中列出的依赖。
  echo 所有过程都会显示在当前窗口，不会隐藏执行。
  choice /C YN /N /M "是否现在安装？[Y/N]: "
  if errorlevel 2 goto :cancelled

  echo.
  echo [安装] 正在执行 npm ci --no-audit --no-fund ...
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络或 npm 配置。
    goto :failed
  )
)

echo.
echo [启动] 将在新的可见命令窗口中运行开发服务器。
echo [地址] http://localhost:5173
echo [停止] 关闭新的命令窗口，或在其中按 Ctrl+C。
echo.

start "FocusFlow Dev Server" cmd.exe /k "cd /d ""%~dp0"" && npm.cmd run dev"
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"
exit /b 0

:node_error
echo [错误] 无法读取 Node.js 版本。
goto :failed

:cancelled
echo.
echo 已取消。未安装任何依赖，也未启动服务。
exit /b 0

:failed
echo.
pause
exit /b 1
