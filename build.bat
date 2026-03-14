@echo off
setlocal enabledelayedexpansion
echo ================================================
echo   Mineral Segmentation App - Protected Build
echo ================================================
echo.

where python >nul 2>&1
if errorlevel 1 ( echo ERROR: Python not found! && pause && exit /b 1 )
where node >nul 2>&1
if errorlevel 1 ( echo ERROR: Node.js not found! && pause && exit /b 1 )

:: Step 1: Install Python dependencies and compile backend (Nuitka)
echo [1/5] Installing backend dependencies and compiling (Nuitka)...
cd backend
python -m pip install -r requirements.txt
if errorlevel 1 ( echo ERROR: Failed to install Python dependencies && cd .. && pause && exit /b 1 )

:: Clean previous Nuitka build artifacts
if exist main.build rmdir /s /q main.build
if exist main.onefile-build rmdir /s /q main.onefile-build
if exist main.dist rmdir /s /q main.dist
if exist dist\backend.exe del dist\backend.exe

python -m nuitka ^
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
if errorlevel 1 ( echo ERROR: Nuitka compilation failed && cd .. && pause && exit /b 1 )
if not exist "dist\backend.exe" (
    echo ERROR: Nuitka compilation failed — dist\backend.exe not found
    cd .. && pause && exit /b 1
)
echo Backend compiled.
cd ..

:: Step 2: Install frontend dependencies
echo [2/5] Installing frontend dependencies...
cd frontend
if not exist node_modules call npm install --silent
cd ..

:: Step 3: Compile Electron main process with bytenode
echo [3/5] Compiling main.js with bytenode (Electron V8)...
cd frontend
:: Must compile with Electron's V8, not system Node
npx bytenode -e -c main.js
if errorlevel 1 ( echo ERROR: bytenode compile main.js failed && cd .. && pause && exit /b 1 )

:: Swap package.json main to main-entry.js for production build
powershell -Command "(Get-Content package.json) -replace '\"main\": \"main.js\"', '\"main\": \"main-entry.js\"' | Set-Content package.json"
cd ..

:: Step 4: Obfuscate renderer with javascript-obfuscator
echo [4/5] Obfuscating renderer (javascript-obfuscator)...
cd frontend
node esbuild.config.mjs
npx javascript-obfuscator src\app-bundle.js ^
    --output src\app-bundle.obf.js ^
    --compact true ^
    --string-array true ^
    --string-array-encoding base64
if errorlevel 1 ( echo ERROR: javascript-obfuscator failed && cd .. && pause && exit /b 1 )

:: Update app.html to use obfuscated bundle
powershell -Command "(Get-Content public\app.html) -replace 'app-bundle\.js', 'app-bundle.obf.js' | Set-Content public\app.html"

:: Step 5: Package with Electron Builder
echo [5/5] Building Electron app...
call npx electron-builder --win
set BUILD_ERR=!errorlevel!

:: Always restore dev files regardless of build result
call :RESTORE_DEV
cd ..

if !BUILD_ERR! neq 0 (
    echo ERROR: electron-builder failed
    pause
    exit /b 1
)

echo.
echo ================================================
echo   BUILD COMPLETE — Output in frontend\dist\
echo ================================================
dir frontend\dist\*.exe 2>nul
pause
exit /b 0

:RESTORE_DEV
powershell -Command "(Get-Content public\app.html) -replace 'app-bundle\.obf\.js', 'app-bundle.js' | Set-Content public\app.html"
powershell -Command "(Get-Content package.json) -replace '\"main\": \"main-entry.js\"', '\"main\": \"main.js\"' | Set-Content package.json"
exit /b 0
