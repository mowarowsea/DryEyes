@echo off
setlocal

echo ========================================================
echo  Starting DryEyes System
echo ========================================================

echo [1/2] Starting changedetection.io & Browser in Docker (WSL2)...
wsl -d Ubuntu -- bash -lc "docker info >/dev/null 2>&1 || sudo -n service docker start >/dev/null 2>&1 || sudo -n /etc/init.d/docker start >/dev/null 2>&1 || true; cd /mnt/c/Users/seamo/DryEyes && docker compose up -d"

echo [2/2] Building and starting DryEyes BFF ^& Frontend...
echo     Serving the production build. The Vite dev server reloads the page by
echo     itself whenever its HMR socket reconnects, which is not what you want
echo     on a phone. Use "npm run dev" instead while changing the code.
npm start
