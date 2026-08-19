#!/usr/bin/env bash
# Tunel SSH a la BD de produccion. Se reconecta solo; Ctrl+C lo mata de verdad.
# ponytail: loop + keepalives en vez de autossh; migrar a autossh si hace falta monitoreo real.
trap 'echo; echo "tunel cerrado"; exit 0' INT

while true; do
  echo "[$(date +%H:%M:%S)] conectando..."
  ssh -i "C:/Users/teams/Servidor/dbtunnel_key" -N \
      -o ServerAliveInterval=20 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -o StrictHostKeyChecking=accept-new \
      -L 55432:127.0.0.1:5432 \
      -L 53306:127.0.0.1:3306 \
      dbtunnel@31.220.91.23
  echo "[$(date +%H:%M:%S)] se cayo (exit $?), reintentando en 3s"
  sleep 3
done
