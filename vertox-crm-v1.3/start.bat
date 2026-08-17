@echo off
title Vertox CRM - Launcher
echo ============================================
echo   Starting Vertox CRM
echo ============================================
echo.

if not exist "backend\.env" (
    echo NOTE: backend\.env not found - it will be auto-created from .env.example on first run.
    echo Please edit backend\.env with your real MSSQL credentials afterwards, then restart.
    echo.
)

echo Starting Vertox CRM on http://localhost:3300 ...
echo (Frontend + Backend now run together on ONE port - no more port mismatch.)
start "Vertox CRM (3300)" cmd /k "cd backend && npm start"

timeout /t 2 /nobreak >nul

echo.
echo ============================================
echo   Vertox CRM is starting
echo ============================================
echo   App:          http://localhost:3300/login.html
echo   Health check: http://localhost:3300/api/health
echo   On phone (same WiFi): http://YOUR-PC-IP:3300/login.html
echo   Login:        genzeadmin / genzeadmin@10
echo   Logs folder:  backend\logs\
echo ============================================
echo.
echo You can close THIS window - the server window will keep running.
pause
