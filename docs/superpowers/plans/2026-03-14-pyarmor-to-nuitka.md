# PyArmor + PyInstaller → Nuitka Migration Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PyArmor + PyInstaller with Nuitka to eliminate the 32KB per-file limit and simplify the build pipeline from 6 to 5 steps.

**Architecture:** Nuitka compiles Python → C → native binary in one step, replacing both PyArmor (obfuscation) and PyInstaller (packaging). No application code changes — only build tooling and dependency files.

**Tech Stack:** Nuitka, GCC (Linux) / MSVC (Windows), uv package manager

**Spec:** `docs/superpowers/specs/2026-03-14-pyarmor-to-nuitka-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/requirements.txt` | Modify | Remove pyarmor/pyinstaller, add nuitka/ordered-set |
| `backend/pyproject.toml` | Modify | Remove pyarmor from dev deps, add nuitka/ordered-set |
| `build.sh` | Rewrite steps 1-2 | Linux build script — replace PyArmor+PyInstaller with Nuitka |
| `build.bat` | Rewrite steps 1-2 | Windows build script — same changes, Windows syntax |
| `backend/backend.spec` | Delete | PyInstaller spec, no longer needed |
| `.gitignore` | Modify | Add Nuitka build artifacts |

---

## Chunk 1: Dependencies and Cleanup

### Task 1: Update dependency files

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Edit `backend/requirements.txt`**

Remove `pyarmor>=9.2.3` (line 12) and `pyinstaller>=6.3.0` (line 15). Add `nuitka` and `ordered-set`.

Final file should be:

```
aiofiles>=23.2.0
fastapi>=0.104.0
numpy>=1.26.0
opencv-contrib-python>=4.8.0
pillow>=10.0.0
python-multipart>=0.0.6
scikit-image>=0.22.0
scipy>=1.11.0
uvicorn>=0.24.0
websockets>=12.0
httpx>=0.28.1
pytest>=9.0.2
pytest-asyncio>=1.3.0
nuitka>=2.5
ordered-set>=4.1.0
```

- [ ] **Step 2: Edit `backend/pyproject.toml`**

In `[dependency-groups] dev`, remove `"pyarmor>=9.2.3",` and add `"nuitka"` and `"ordered-set"`.

The dev section should become:

```toml
[dependency-groups]
dev = [
    "httpx>=0.28.1",
    "nuitka>=2.5",
    "ordered-set>=4.1.0",
    "pytest>=9.0.2",
    "pytest-asyncio>=1.3.0",
    "pytest-cov>=7.0.0",
]
```

- [ ] **Step 3: Install updated dependencies**

Run: `cd backend && uv pip install -r requirements.txt`
Expected: installs nuitka and ordered-set, no errors

- [ ] **Step 4: Verify Nuitka is installed and check Python version compatibility**

Run: `cd backend && uv run python -m nuitka --version`
Expected: prints Nuitka version. If it fails with a Python 3.14 error, note this as a blocker.

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: all tests pass (dependency changes should not affect tests)

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/pyproject.toml
git commit -m "build: replace pyarmor/pyinstaller deps with nuitka"
```

---

### Task 2: Delete `backend.spec` and update `.gitignore`

**Files:**
- Delete: `backend/backend.spec`
- Modify: `.gitignore`

- [ ] **Step 1: Delete `backend/backend.spec`**

```bash
git rm backend/backend.spec
```

- [ ] **Step 2: Update `.gitignore`**

Add Nuitka build artifacts. These directories are created during compilation and should not be committed:

```
# Nuitka build artifacts
*.build/
*.onefile-build/
*.dist/
```

Add these lines to the existing `.gitignore`.

- [ ] **Step 3: Clean up any existing PyArmor artifacts**

```bash
rm -rf backend/dist/pyarmor_dist
```

- [ ] **Step 4: Commit**

```bash
git add backend/backend.spec .gitignore
git commit -m "build: remove PyInstaller spec, add Nuitka artifacts to gitignore"
```

---

## Chunk 2: Build Scripts

### Task 3: Rewrite `build.sh` (Linux)

**Files:**
- Modify: `build.sh`

- [ ] **Step 1: Replace steps 1 and 2 with Nuitka**

Replace everything from `# Step 1:` through `cd ..` after step 2 (lines 24-58 of current file) with:

```bash
# Step 1: Install Python dependencies and compile backend (Nuitka)
echo "[1/5] Installing backend dependencies and compiling (Nuitka)..."
cd backend
uv pip install -r requirements.txt

# Clean previous Nuitka build artifacts
rm -rf main.build main.onefile-build main.dist dist/backend

uv run python -m nuitka \
  --onefile \
  --output-dir=dist \
  --output-filename=backend \
  --python-flag=no_docstrings \
  --follow-import-to=aligner,segmentation,undo \
  --nofollow-import-to=pytest,setuptools,pip,pyarmor \
  --include-module=cv2 \
  --include-module=numpy \
  --include-module=scipy \
  --include-module=skimage \
  --include-module=fastapi \
  --include-module=uvicorn \
  --include-module=pydantic \
  --include-module=starlette \
  --include-module=anyio \
  --include-module=multipart \
  --include-module=h11 \
  --include-module=PIL \
  --include-module=websockets \
  main.py

if [ ! -f "dist/backend" ]; then
    echo "ERROR: Nuitka compilation failed — dist/backend not found"
    exit 1
fi
echo "Backend compiled."
cd ..
```

- [ ] **Step 2: Renumber remaining steps from [2/5] to [5/5]**

Update step labels:
- `[3/6]` → `[2/5]` (Install frontend deps)
- `[4/6]` → `[3/5]` (Bytenode)
- `[5/6]` → `[4/5]` (javascript-obfuscator)
- `[6/6]` → `[5/5]` (electron-builder)

- [ ] **Step 3: Verify the full `build.sh`**

The final `build.sh` should be:

```bash
#!/bin/bash

# ================================================
#   Mineral Segmentation App - Protected Build (Linux)
# ================================================

set -e # Exit on error

echo "================================================"
echo "   Mineral Segmentation App - Protected Build"
echo "================================================"
echo

# Check dependencies
if ! command -v uv &> /dev/null; then
    echo "ERROR: uv not found! Please install uv (https://astral.sh/uv)"
    exit 1
fi
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found!"
    exit 1
fi

# Step 1: Install Python dependencies and compile backend (Nuitka)
echo "[1/5] Installing backend dependencies and compiling (Nuitka)..."
cd backend
uv pip install -r requirements.txt

# Clean previous Nuitka build artifacts
rm -rf main.build main.onefile-build main.dist dist/backend

uv run python -m nuitka \
  --onefile \
  --output-dir=dist \
  --output-filename=backend \
  --python-flag=no_docstrings \
  --follow-import-to=aligner,segmentation,undo \
  --nofollow-import-to=pytest,setuptools,pip,pyarmor \
  --include-module=cv2 \
  --include-module=numpy \
  --include-module=scipy \
  --include-module=skimage \
  --include-module=fastapi \
  --include-module=uvicorn \
  --include-module=pydantic \
  --include-module=starlette \
  --include-module=anyio \
  --include-module=multipart \
  --include-module=h11 \
  --include-module=PIL \
  --include-module=websockets \
  main.py

if [ ! -f "dist/backend" ]; then
    echo "ERROR: Nuitka compilation failed — dist/backend not found"
    exit 1
fi
echo "Backend compiled."
cd ..

# Step 2: Install frontend dependencies
echo "[2/5] Installing frontend dependencies..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm install --silent
fi
cd ..

# Step 3: Compile Electron main process with bytenode
echo "[3/5] Compiling main.js with bytenode (Electron V8)..."
cd frontend
# Must compile with Electron's V8
npx bytenode -e -c main.js

# Swap package.json main to main-entry.js for production build using sed
sed -i 's/"main": "main.js"/"main": "main-entry.js"/' package.json
cd ..

# Step 4: Obfuscate renderer with javascript-obfuscator
echo "[4/5] Obfuscating renderer (javascript-obfuscator)..."
cd frontend
npx javascript-obfuscator src/app-bundle.js \
    --output src/app-bundle.obf.js \
    --compact true \
    --string-array true \
    --string-array-encoding base64

# Update app.html to use obfuscated bundle using sed
sed -i 's/app-bundle\.js/app-bundle.obf.js/g' public/app.html

# Ensure dev files are restored even if build fails
restore_dev_files() {
    cd /home/cordis/Gits/python/two/new2/frontend
    sed -i 's/app-bundle\.obf\.js/app-bundle.js/g' public/app.html
    sed -i 's/"main": "main-entry.js"/"main": "main.js"/' package.json
}
trap restore_dev_files EXIT

# Step 5: Package with Electron Builder (AppImage only)
echo "[5/5] Building Electron app..."
npx electron-builder --linux AppImage

cd ..
echo
echo "================================================"
echo "   BUILD COMPLETE — Output in frontend/dist/"
echo "================================================"
ls -F frontend/dist/
```

- [ ] **Step 4: Commit**

```bash
git add build.sh
git commit -m "build: replace PyArmor+PyInstaller with Nuitka in build.sh"
```

---

### Task 4: Rewrite `build.bat` (Windows)

**Files:**
- Modify: `build.bat`

Note: The current `build.bat` was missing `undo.py` from the PyArmor command (a pre-existing bug). This is implicitly fixed by Nuitka's `--follow-import-to=aligner,segmentation,undo` which auto-discovers imports.

- [ ] **Step 1: Rewrite the full `build.bat`**

The final `build.bat` should be:

```batch
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
  --python-flag=no_docstrings ^
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
```

- [ ] **Step 2: Commit**

```bash
git add build.bat
git commit -m "build: replace PyArmor+PyInstaller with Nuitka in build.bat"
```

---

## Chunk 3: Verification

### Task 5: Verify Nuitka compilation works

**Files:** None (verification only)

- [ ] **Step 1: Run existing tests to confirm nothing is broken**

Run: `cd backend && uv run python -m pytest tests/ -v`
Expected: all tests pass

- [ ] **Step 2: Test Nuitka compilation on the backend**

Run from `backend/`:

```bash
uv run python -m nuitka \
  --onefile \
  --output-dir=dist \
  --output-filename=backend \
  --python-flag=no_docstrings \
  --follow-import-to=aligner,segmentation,undo \
  --nofollow-import-to=pytest,setuptools,pip,pyarmor \
  --include-module=cv2 \
  --include-module=numpy \
  --include-module=scipy \
  --include-module=skimage \
  --include-module=fastapi \
  --include-module=uvicorn \
  --include-module=pydantic \
  --include-module=starlette \
  --include-module=anyio \
  --include-module=multipart \
  --include-module=h11 \
  --include-module=PIL \
  --include-module=websockets \
  main.py
```

Expected: compilation completes, `dist/backend` binary exists.
This will take 15-45 minutes on first run.

- [ ] **Step 3: Test the compiled binary starts**

Run: `cd backend && ./dist/backend`
Expected: FastAPI starts on `127.0.0.1:8001`, prints "Uvicorn running on http://127.0.0.1:8001"
Stop with Ctrl+C.

- [ ] **Step 4: Run full build**

Run: `./build.sh`
Expected: all 5 steps complete, AppImage created in `frontend/dist/`.

- [ ] **Step 5: Smoke-test the AppImage**

Launch the AppImage, verify:
- Application window opens
- Can load images
- Segmentation runs
- Tag operations work
