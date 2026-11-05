@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Minecraft Seed Map - Local Offline

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERROR] Node.js not found.
  echo   Install it from https://nodejs.org/ then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Minecraft Seed Map - Local Offline
echo   ZH : http://127.0.0.1:3456/zh-CN/tools/seed-map
echo   EN : http://127.0.0.1:3456/tools/seed-map
echo.
echo   Close this window to stop the server.
echo.

node serve.mjs 3456
pause
