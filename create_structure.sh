#!/bin/bash
# Directory structure creation script for Mineral Segmentation App

echo "Creating Mineral Segmentation App directory structure..."

# Create main directories
mkdir -p backend
mkdir -p frontend/src/components
mkdir -p frontend/src/hooks
mkdir -p frontend/src/utils
mkdir -p frontend/src/styles
mkdir -p frontend/public
mkdir -p output

# Create empty placeholder files
touch backend/__init__.py
touch frontend/src/components/.gitkeep
touch frontend/src/hooks/.gitkeep
touch frontend/src/utils/.gitkeep

echo "Directory structure created successfully!"
echo ""
echo "Directory tree:"
find . -type d | head -20
