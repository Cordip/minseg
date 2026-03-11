#!/usr/bin/env python3
"""
Setup verification script for Mineral Segmentation App.
Run this to verify all dependencies are correctly installed.
"""

import sys
import subprocess
import importlib

def check_python_version():
    """Check Python version is 3.9+"""
    version = sys.version_info
    print(f"Python version: {version.major}.{version.minor}.{version.micro}")
    
    if version.major < 3 or (version.major == 3 and version.minor < 9):
        print("❌ Python 3.9+ is required!")
        return False
    print("✅ Python version OK")
    return True

def check_package(package_name, import_name=None):
    """Check if a Python package is installed"""
    try:
        importlib.import_module(import_name or package_name)
        print(f"✅ {package_name} installed")
        return True
    except ImportError:
        print(f"❌ {package_name} NOT installed")
        return False

def check_node():
    """Check Node.js installation"""
    try:
        result = subprocess.run(['node', '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✅ Node.js installed: {result.stdout.strip()}")
            return True
    except FileNotFoundError:
        pass
    print("❌ Node.js NOT installed")
    return False

def check_npm():
    """Check npm installation"""
    try:
        result = subprocess.run(['npm', '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✅ npm installed: {result.stdout.strip()}")
            return True
    except FileNotFoundError:
        pass
    print("❌ npm NOT installed")
    return False

def main():
    print("=" * 60)
    print("Mineral Segmentation App - Setup Verification")
    print("=" * 60)
    print()
    
    all_ok = True
    
    # Check Python
    print("### Python Environment ###")
    all_ok &= check_python_version()
    print()
    
    # Check Python packages
    print("### Python Packages ###")
    packages = [
        ('fastapi', None),
        ('uvicorn', None),
        ('opencv-python', 'cv2'),
        ('numpy', None),
        ('scikit-image', 'skimage'),
        ('scipy', None),
        ('Pillow', 'PIL'),
        ('websockets', None),
        ('aiofiles', None),
        ('python-multipart', 'multipart'),
    ]
    
    for pkg, imp in packages:
        all_ok &= check_package(pkg, imp)
    print()
    
    # Check Node.js
    print("### Node.js Environment ###")
    all_ok &= check_node()
    all_ok &= check_npm()
    print()
    
    # Summary
    print("=" * 60)
    if all_ok:
        print("✅ All dependencies are installed correctly!")
        print()
        print("To start the app:")
        print("  1. Run: start.bat")
        print("  Or manually:")
        print("  1. cd backend && python -m uvicorn main:app --port 8000")
        print("  2. cd frontend && npm start")
    else:
        print("❌ Some dependencies are missing.")
        print()
        print("To install missing dependencies:")
        print("  Python: pip install -r backend/requirements.txt")
        print("  Node.js: cd frontend && npm install")
    print("=" * 60)
    
    return 0 if all_ok else 1

if __name__ == "__main__":
    sys.exit(main())
