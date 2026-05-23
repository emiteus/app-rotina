@echo off
cd /d C:\Users\mateu\app-rotina

REM Inicia o servidor Node.js em background
start cmd /k npm start

REM Aguarda o servidor iniciar
timeout /t 3 /nobreak

REM Inicia o Electron
start "" npm run electron-dev

REM Fecha este prompt
exit
