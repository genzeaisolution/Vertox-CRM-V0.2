@echo off
title Vertox CRM - Installer
echo ============================================
echo   Vertox CRM - Installing Dependencies
echo ============================================
echo.

echo Installing backend dependencies...
cd backend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Backend npm install failed. Check the messages above.
    pause
    exit /b 1
)
cd ..

echo.
echo ============================================
echo   Installation complete!
echo ============================================
echo.
echo Next steps:
echo   1. Run database\schema.sql in SQL Server Management Studio
echo   2. Open backend\.env and set your MSSQL credentials
echo      (if backend\.env doesn't exist yet, copy backend\.env.example to backend\.env)
echo   3. Run start.bat to launch Vertox CRM
echo.
pause
