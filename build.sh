#!/bin/bash
set -e

echo "================================================"
echo "   Mineral Segmentation - Protected Build"
echo "================================================"
echo

# Check dependencies
command -v uv &>/dev/null || { echo "ERROR: uv not found!"; exit 1; }
command -v node &>/dev/null || { echo "ERROR: Node.js not found!"; exit 1; }
command -v cargo &>/dev/null || { echo "ERROR: Rust not found!"; exit 1; }

# Step 1: Compile backend (Nuitka)
echo "[1/2] Compiling backend (Nuitka)..."
cd backend
uv pip install -r requirements.txt
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

[ -f "dist/backend" ] || { echo "ERROR: Nuitka failed"; exit 1; }
echo "Backend compiled."

# Copy binary as Tauri sidecar
mkdir -p ../frontend/src-tauri/binaries
cp dist/backend ../frontend/src-tauri/binaries/backend-x86_64-unknown-linux-gnu
cd ..

# Step 2: Build Tauri app (Vite + Rust + packaging)
echo "[2/2] Building Tauri app..."
cd frontend
npm install
npm run tauri build

cd ..
echo
echo "================================================"
echo "   BUILD COMPLETE — Output in frontend/src-tauri/target/release/bundle/"
echo "================================================"
ls frontend/src-tauri/target/release/bundle/appimage/ 2>/dev/null || true
ls frontend/src-tauri/target/release/bundle/deb/ 2>/dev/null || true
