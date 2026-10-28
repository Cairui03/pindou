@echo off
chcp 65001 >nul
title Pindou Web Server (keep this window open)
cd /d "%~dp0"
if not exist "index.html" (
  echo [!] index.html not found in this folder.
  echo     Keep index.html next to this .bat file.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)
node server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
