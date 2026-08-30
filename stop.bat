@echo off
setlocal

echo Stopping DryEyes Docker containers...
wsl -d Ubuntu -- bash -lc "cd /mnt/c/Users/seamo/Dry-eyed && docker compose stop"
