/**
 * Preload Script for Mineral Segmentation App
 */

const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

console.log('[Preload] Loading preload script...');

// Read file and return as buffer array (works with large files)
function readFileBuffer(filePath) {
    try {
        console.log('[Preload] Reading file:', filePath);
        
        const normalizedPath = path.normalize(filePath);
        console.log('[Preload] Normalized path:', normalizedPath);
        
        if (!fs.existsSync(normalizedPath)) {
            console.error('[Preload] File does not exist:', normalizedPath);
            return null;
        }
        
        const buffer = fs.readFileSync(normalizedPath);
        // Return as Array (works better with contextBridge than Buffer)
        const array = Array.from(buffer);
        console.log('[Preload] File read successfully, size:', buffer.length, 'bytes');
        return { data: array, size: buffer.length };
    } catch (error) {
        console.error('[Preload] Error reading file:', error.message);
        console.error('[Preload] Stack:', error.stack);
        return null;
    }
}

// Legacy base64 method for small files
function safeReadFile(filePath) {
    try {
        console.log('[Preload] Reading file (base64):', filePath);
        const normalizedPath = path.normalize(filePath);
        
        if (!fs.existsSync(normalizedPath)) {
            console.error('[Preload] File does not exist:', normalizedPath);
            return null;
        }
        
        const buffer = fs.readFileSync(normalizedPath);
        const base64 = buffer.toString('base64');
        console.log('[Preload] File read successfully, size:', buffer.length, 'bytes');
        return base64;
    } catch (error) {
        console.error('[Preload] Error reading file:', error.message);
        return null;
    }
}

function safeWriteFile(filePath, data) {
    try {
        const normalizedPath = path.normalize(filePath);
        fs.writeFileSync(normalizedPath, Buffer.from(data, 'base64'));
        return true;
    } catch (error) {
        console.error('[Preload] Error writing file:', error.message);
        return false;
    }
}

function safeFileExists(filePath) {
    try {
        return fs.existsSync(path.normalize(filePath));
    } catch (error) {
        return false;
    }
}

function safeGetFileInfo(filePath) {
    try {
        const normalizedPath = path.normalize(filePath);
        const stats = fs.statSync(normalizedPath);
        return {
            exists: true,
            size: stats.size,
            name: path.basename(normalizedPath),
            directory: path.dirname(normalizedPath)
        };
    } catch (error) {
        return { exists: false, error: error.message };
    }
}

try {
    contextBridge.exposeInMainWorld('electronAPI', {
        selectSingleImage: () => ipcRenderer.invoke('select-single-image'),
        selectImages: () => ipcRenderer.invoke('select-images'),
        selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
        getApiUrl: () => ipcRenderer.invoke('get-api-url'),
        readFile: safeReadFile,
        readFileBuffer: readFileBuffer,
        getFileName: (filePath) => path.basename(filePath),
        writeFile: safeWriteFile,
        fileExists: safeFileExists,
        getFileInfo: safeGetFileInfo,
        openEditor: () => ipcRenderer.invoke('open-editor'),
        isAvailable: true
    });
    
    console.log('[Preload] electronAPI successfully exposed');
} catch (error) {
    console.error('[Preload] Failed to expose electronAPI:', error);
}
