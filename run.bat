@echo off
title LUMEN FLIX - Streaming Server
echo ========================================================
echo   LUMEN FLIX - Premium Kino Platformasi
echo ========================================================
echo.
cd /d "%~dp0"
echo Server ishga tushmoqda va brauzerda ochilmoqda...
start http://localhost:3000
node server.js
pause
