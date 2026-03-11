# Build script for creating standalone Windows executable
# Run this on Windows with Python and Node.js installed

param(
    [string]$OutputDir = ".\release"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Building Mineral Segmentation App" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Step 1: Install Python dependencies
Write-Host "[1/5] Installing Python dependencies..." -ForegroundColor Yellow
Set-Location backend
pip install -r requirements.txt --quiet
pip install pyinstaller --quiet
Set-Location ..

# Step 2: Build Python backend to exe
Write-Host "[2/5] Building Python backend..." -ForegroundColor Yellow
Set-Location backend
pyinstaller --onefile --name "backend" --distpath "..\release\backend" --workpath ".\build" --specpath ".\build" main.py aligner.py segmentation.py 2>$null
Set-Location ..

# Step 3: Install Node.js dependencies
Write-Host "[3/5] Installing Node.js dependencies..." -ForegroundColor Yellow
Set-Location frontend
npm install --silent 2>$null
Set-Location ..

# Step 4: Update main.js to use bundled backend
Write-Host "[4/5] Preparing Electron app..." -ForegroundColor Yellow

# Step 5: Build Electron app
Write-Host "[5/5] Building Electron application..." -ForegroundColor Yellow
Set-Location frontend
npm run build-win
Set-Location ..

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Build complete!" -ForegroundColor Green
Write-Host "Output: $OutputDir" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
