@echo off
REM Arranca el servicio IA en puerto 8090 usando el venv local.
REM Primera vez: corre `npm run ai:install` desde Backend/ antes.
cd /d "%~dp0"
if not exist ".venv\Scripts\uvicorn.exe" (
  echo [ERROR] El venv no existe. Corre primero: npm run ai:install
  pause
  exit /b 1
)
.venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8090 --reload
