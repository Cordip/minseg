@echo off
echo ================================================
echo   Mineral Segmentation App
echo ================================================
echo.

:: Show current Python environment
echo Current Python:
python --version 2>nul
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

:: Check uvicorn
python -c "import uvicorn" 2>nul
if errorlevel 1 (
    echo.
    echo ERROR: uvicorn not found in current Python environment!
    echo Please activate your venv and install uvicorn:
    echo.
    echo   ovenv\Scripts\activate
    echo   pip install uvicorn fastapi
    echo   .\start.bat
    echo.
    pause
    exit /b 1
)

:: Show venv info
if defined VIRTUAL_ENV (
    echo Using VIRTUAL_ENV: %VIRTUAL_ENV%
) else (
    echo WARNING: VIRTUAL_ENV not set. Using system Python.
)
echo.

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
echo Backend: http://127.0.0.1:8001
echo.

cd frontend
call npx electron .
cd ..

pause
