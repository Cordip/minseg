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
