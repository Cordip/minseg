@echo off
echo ================================================
echo   Mineral Segmentation App
echo ================================================
echo.

:: Check Python
where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found! Install Python 3.9+
    pause
    exit /b 1
)

:: Check Node
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found! Install Node.js 18+
    pause
    exit /b 1
)

:: Check for venv and activate
if exist "venv\Scripts\activate.bat" (
    echo Found venv, activating...
    call venv\Scripts\activate.bat
)
if exist "..\venv\Scripts\activate.bat" (
    echo Found venv in parent, activating...
    call ..\venv\Scripts\activate.bat
)
if exist "..\ovenv\Scripts\activate.bat" (
    echo Found ovenv in parent, activating...
    call ..\ovenv\Scripts\activate.bat
)

:: Install Python dependencies
echo [1/3] Installing Python dependencies...
cd backend
pip install -r requirements.txt --quiet 2>nul
cd ..

:: Install Node.js dependencies
echo [2/3] Installing Node.js dependencies...
cd frontend
if not exist node_modules (
    echo Installing npm packages...
    call npm install
) else (
    echo npm packages already installed.
)
cd ..

:: Start
echo [3/3] Starting application...
echo Backend: http://127.0.0.1:8000
echo.

cd frontend
call npx electron .
cd ..

pause
