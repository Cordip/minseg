@echo off
setlocal enabledelayedexpansion
echo ================================================
echo   Mineral Segmentation - Protected Build
echo ================================================
echo.

where python >nul 2>&1
if errorlevel 1 ( echo ERROR: Python not found! && pause && exit /b 1 )
where node >nul 2>&1
if errorlevel 1 ( echo ERROR: Node.js not found! && pause && exit /b 1 )
where cargo >nul 2>&1
if errorlevel 1 ( echo ERROR: Rust not found! && pause && exit /b 1 )

:: Step 1: Compile backend (Nuitka)
echo [1/2] Compiling backend (Nuitka)...
cd backend
python -m pip install -r requirements.txt
if errorlevel 1 ( echo ERROR: pip install failed && cd .. && pause && exit /b 1 )

if exist main.build rmdir /s /q main.build
if exist main.onefile-build rmdir /s /q main.onefile-build
if exist main.dist rmdir /s /q main.dist
if exist dist\backend.exe del dist\backend.exe

python -m nuitka ^
  --assume-yes-for-downloads ^
  --onefile ^
  --output-dir=dist ^
  --output-filename=backend ^
  --follow-import-to=aligner,segmentation,undo ^
  --nofollow-import-to=pytest,setuptools,pip,pyarmor ^
  --include-module=cv2 ^
  --include-module=numpy ^
  --include-module=scipy ^
  --include-module=skimage ^
  --include-module=fastapi ^
  --include-module=uvicorn ^
  --include-module=pydantic ^
  --include-module=starlette ^
  --include-module=anyio ^
  --include-module=multipart ^
  --include-module=h11 ^
  --include-module=PIL ^
  --include-module=websockets ^
  main.py
if errorlevel 1 ( echo ERROR: Nuitka failed && cd .. && pause && exit /b 1 )
if not exist "dist\backend.exe" ( echo ERROR: backend.exe not found && cd .. && pause && exit /b 1 )
echo Backend compiled.

:: Copy binary as Tauri sidecar
if not exist ..\frontend\src-tauri\binaries mkdir ..\frontend\src-tauri\binaries
copy dist\backend.exe ..\frontend\src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe
cd ..

:: Step 2: Build Tauri app
echo [2/2] Building Tauri app...
cd frontend
call npm install
call npx tauri build
if errorlevel 1 ( echo ERROR: Tauri build failed && cd .. && pause && exit /b 1 )
cd ..

echo.
echo ================================================
echo   BUILD COMPLETE
echo ================================================
dir frontend\src-tauri\target\release\bundle\nsis\*.exe 2>nul
pause
exit /b 0
