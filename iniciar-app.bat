@echo off
REM App Rotina - Launcher Otimizado
REM Inicia o servidor e o Electron invisíveis

cd /d C:\Users\mateu\app-rotina

REM Verifica se servidor já está rodando
setlocal enabledelayedexpansion
set "serverRunning=0"
for /f "tokens=*" %%A in ('tasklist ^| find /i "node"') do (
  set "serverRunning=1"
)

REM Se servidor não está rodando, inicia
if !serverRunning! equ 0 (
  start "" /B node server.js
  timeout /t 3 /nobreak >nul
)

REM Inicia Electron
start "" /B npm run electron-dev

REM Fecha este script
exit /b 0
