@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ====================================================
echo  启动 浪叉多平台发布助手 (开发调试模式)
echo ====================================================

set "MOCKDIR=%APPDATA%\fanpost-dev\mock-license"
set "FANPOST_LICENSE_SERVER=http://127.0.0.1:8787"
set "FANPOST_LICENSE_PUBKEY_FILE=%MOCKDIR%\dev-public.pem"
set "FANPOST_PACK_PUBKEY_FILE=%MOCKDIR%\pack-public.pem"
set "ELECTRON_RUN_AS_NODE="
set "FANPOST_USER_DATA_DIR="

echo 检查本地授权 mock 服务器(127.0.0.1:8787)...
netstat -ano | findstr /c:":8787 " | findstr LISTENING >nul
if errorlevel 1 (
  echo   未运行，正在启动...
  start "FanPost 授权 mock" /min cmd /c "chcp 65001 >nul && node dev\scripts\mock-license-server.mjs"
  timeout /t 3 >nul
) else (
  echo   已在运行。
)

echo 启动开发版(改主进程代码需重启)...
npx electron-vite dev --remoteDebuggingPort 9222
pause
