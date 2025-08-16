@echo off
setlocal
pushd %~dp0

REM 1) Install deps only if needed
IF NOT EXIST node_modules (
  echo [install] Installing dependencies...
  call npm install || goto :err
)

REM 2) Run dev server and auto-open browser
echo [dev] Starting Vite (Ctrl+C to stop)...
call npm run dev -- --open
popd
exit /b 0

:err
echo [error] npm install failed.
pause
exit /b 1