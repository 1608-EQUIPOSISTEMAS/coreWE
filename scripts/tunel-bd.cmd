@echo off
REM Tunel SSH a la BD de produccion (Neon 55432) y MySQL (53306).
REM ServerAliveInterval mata la conexion muerta rapido; el loop la vuelve a levantar.
:loop
REM Si otro tunel ya tiene el 55432, esperar en silencio en vez de fallar cada 5s
REM con "bind: Permission denied". Asi una 2da copia queda de reserva y toma el
REM relevo sola cuando la 1ra se muere.
netstat -ano | find "127.0.0.1:55432" | find "LISTENING" >nul
if not errorlevel 1 (
  timeout /t 15 /nobreak >nul
  goto loop
)
ssh -i C:\Users\teams\Servidor\dbtunnel_key -N ^
 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 ^
 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new ^
 -L 55432:127.0.0.1:5432 -L 53306:127.0.0.1:3306 dbtunnel@31.220.91.23
echo [%date% %time%] tunel caido, reconectando en 5s...
timeout /t 5 /nobreak >nul
goto loop
