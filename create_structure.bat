@echo off
echo Creating Mineral Segmentation App directory structure...
echo.

:: Create main directories
if not exist backend mkdir backend
if not exist frontend\src\components mkdir frontend\src\components
if not exist frontend\src\hooks mkdir frontend\src\hooks
if not exist frontend\src\utils mkdir frontend\src\utils
if not exist frontend\src\styles mkdir frontend\src\styles
if not exist frontend\public mkdir frontend\public
if not exist output mkdir output

:: Create empty placeholder files
type nul > backend\__init__.py

echo Directory structure created successfully!
echo.
echo Directory tree:
tree /F /A

echo.
echo Now run: verify_setup.py
echo Then run: start.bat

pause
