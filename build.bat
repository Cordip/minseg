@echo off
setlocal enabledelayedexpansion
echo ================================================
echo   Mineral Segmentation App - Build Script
echo ================================================
echo.
echo This script will create a standalone executable.
echo.

:: Check requirements
where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found!
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found!
    pause
    exit /b 1
)

:: Step 1: Install Python dependencies
echo [1/5] Installing Python dependencies...
cd backend
pip install -r requirements.txt --quiet 2>nul
pip install pyinstaller --quiet 2>nul
cd ..

:: Step 2: Build backend to standalone exe (using spec file with excludes)
echo [2/5] Building Python backend to exe...
cd backend
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

pyinstaller --clean --noconfirm backend.spec

if not exist "dist\backend.exe" (
    echo ERROR: Failed to build backend.exe
    pause
    exit /b 1
)
echo Backend built successfully!
cd ..

:: Step 3: Prepare frontend
echo [3/5] Preparing frontend...
cd frontend
if exist node_modules (
    echo node_modules exists, skipping npm install
) else (
    call npm install --silent 2>nul
)
cd..

:: Step 4: Copy backend exe to resources
echo [4/5] Packaging backend...
if not exist "frontend\build" mkdir "frontend\build"
if not exist "frontend\build\backend" mkdir "frontend\build\backend"
copy /Y "backend\dist\backend.exe" "frontend\build\backend\" >nul

:: Step 5: Build Electron app
echo [5/5] Building Electron application...
cd frontend
call npm run build
cd ..

echo.
echo ================================================
echo   BUILD COMPLETE!
echo ================================================
echo.
echo Output files are in: frontend\dist\
echo.
dir frontend\dist\*.exe 2>nul
echo.
pause
