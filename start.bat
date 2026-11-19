@echo off
cd /d "%~dp0"
if not exist dist\server\main.js call npm run build
node dist\server\main.js
pause
